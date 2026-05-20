import { describe, expect, it, vi } from "vitest";

import type { PrismaService } from "../../prisma/prisma.service";
import { PrismaRequirementRepository } from "./prisma-requirement.repository";

describe("PrismaRequirementRepository", () => {
  it("scopes requirement detail aggregate queries by tenant and space", async () => {
    const requirement = makeRequirement();
    const attachmentFindMany = vi.fn(async () => []);
    const workItemFindMany = vi.fn(async () => []);
    const bugDetailFindMany = vi.fn(async () => []);
    const prisma = {
      client: {
        attachment: {
          findMany: attachmentFindMany,
        },
        bugDetail: {
          findMany: bugDetailFindMany,
        },
        requirement: {
          findFirst: vi.fn(async () => requirement),
        },
        tagAssignment: {
          findMany: vi.fn(async () => []),
        },
        workItem: {
          findMany: workItemFindMany,
        },
      },
    } as unknown as PrismaService;
    const repository = new PrismaRequirementRepository(prisma);

    await repository.findById(requirement.id);

    expect(attachmentFindMany).toHaveBeenCalledWith({
      orderBy: {
        createdAt: "asc",
      },
      where: {
        deletedAt: null,
        organizationId: requirement.organizationId,
        spaceId: requirement.spaceId,
        targetId: requirement.id,
        targetType: "REQUIREMENT",
      },
    });
    expect(workItemFindMany).toHaveBeenCalledWith({
      orderBy: [{ type: "asc" }, { createdAt: "asc" }],
      select: expect.objectContaining({
        assigneeId: true,
        createdAt: true,
        id: true,
        organizationId: true,
        requirementId: true,
        spaceId: true,
        statusCategory: true,
        title: true,
        type: true,
        versionId: true,
      }),
      where: {
        deletedAt: null,
        OR: [
          {
            organizationId: requirement.organizationId,
            requirementId: {
              in: [requirement.id],
            },
            spaceId: requirement.spaceId,
          },
        ],
      },
    });
    expect(bugDetailFindMany).not.toHaveBeenCalled();
  });

  it("scopes requirement list aggregate queries by each requirement tenant", async () => {
    const first = makeRequirement();
    const second = makeRequirement({
      id: "01H00000000000000000000006",
      organizationId: "01H00000000000000000000007",
      spaceId: "01H00000000000000000000008",
    });
    const attachmentFindMany = vi.fn(async () => []);
    const workItemFindMany = vi.fn(async () => []);
    const bugDetailFindMany = vi.fn(async () => []);
    const prisma = {
      client: {
        $transaction: vi.fn(async (queries) => Promise.all(queries)),
        attachment: {
          findMany: attachmentFindMany,
        },
        bugDetail: {
          findMany: bugDetailFindMany,
        },
        objectParticipant: {
          findMany: vi.fn(async () => []),
        },
        requirement: {
          count: vi.fn(async () => 2),
          findMany: vi.fn(async () => [first, second]),
          groupBy: vi.fn(async () => []),
        },
        tagAssignment: {
          findMany: vi.fn(async () => []),
        },
        workItem: {
          findMany: workItemFindMany,
        },
      },
    } as unknown as PrismaService;
    const repository = new PrismaRequirementRepository(prisma);

    await repository.listBySpaceId(first.spaceId, {
      actorUserId: first.authorId,
      page: 1,
      pageSize: 20,
      visibility: "ALL",
    });

    expect(attachmentFindMany).toHaveBeenCalledWith({
      orderBy: {
        createdAt: "asc",
      },
      where: {
        deletedAt: null,
        OR: [
          {
            organizationId: first.organizationId,
            spaceId: first.spaceId,
            targetId: first.id,
          },
          {
            organizationId: second.organizationId,
            spaceId: second.spaceId,
            targetId: second.id,
          },
        ],
        targetType: "REQUIREMENT",
      },
    });
    expect(workItemFindMany).toHaveBeenCalledWith({
      orderBy: [{ type: "asc" }, { createdAt: "asc" }],
      select: expect.objectContaining({
        assigneeId: true,
        createdAt: true,
        id: true,
        organizationId: true,
        requirementId: true,
        spaceId: true,
        statusCategory: true,
        title: true,
        type: true,
        versionId: true,
      }),
      where: {
        deletedAt: null,
        OR: [
          {
            organizationId: first.organizationId,
            requirementId: {
              in: [first.id],
            },
            spaceId: first.spaceId,
          },
          {
            organizationId: second.organizationId,
            requirementId: {
              in: [second.id],
            },
            spaceId: second.spaceId,
          },
        ],
      },
    });
    expect(bugDetailFindMany).not.toHaveBeenCalled();
  });

  it("applies tag filters to requirement list and status counts", async () => {
    const requirement = makeRequirement();
    const tagId = "01H00000000000000000000021";
    const tagAssignmentFindMany = vi.fn(async () => [
      {
        tagId,
        targetId: requirement.id,
      },
    ]);
    const requirementFindMany = vi.fn(async () => []);
    const requirementCount = vi.fn(async () => 0);
    const requirementGroupBy = vi.fn(async (_args: unknown) => [
      {
        _count: { _all: 1 },
        status: "CONFIRMED",
      },
    ]);
    const prisma = {
      client: {
        $transaction: vi.fn(async (queries) => Promise.all(queries)),
        objectParticipant: {
          findMany: vi.fn(async () => []),
        },
        requirement: {
          count: requirementCount,
          findMany: requirementFindMany,
          groupBy: requirementGroupBy,
        },
        tagAssignment: {
          findMany: tagAssignmentFindMany,
        },
      },
    } as unknown as PrismaService;
    const repository = new PrismaRequirementRepository(prisma);

    const result = await repository.listBySpaceId(requirement.spaceId, {
      actorUserId: requirement.authorId,
      page: 1,
      pageSize: 20,
      status: "ARCHIVED",
      tagIds: tagId,
      tagMatch: "ALL",
      visibility: "ALL",
    });

    expect(result.statusCounts).toEqual([
      {
        count: 1,
        status: "CONFIRMED",
      },
    ]);
    expect(tagAssignmentFindMany).toHaveBeenCalledWith({
      select: {
        tagId: true,
        targetId: true,
      },
      where: {
        deletedAt: null,
        spaceId: requirement.spaceId,
        tag: {
          deletedAt: null,
          spaceId: requirement.spaceId,
        },
        tagId: {
          in: [tagId],
        },
        targetType: "REQUIREMENT",
      },
    });
    expect(requirementFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: [
            {
              id: {
                in: [requirement.id],
              },
            },
          ],
          spaceId: requirement.spaceId,
          status: "ARCHIVED",
        }),
      }),
    );
    expect(requirementCount).toHaveBeenCalledWith({
      where: expect.objectContaining({
        AND: [
          {
            id: {
              in: [requirement.id],
            },
          },
        ],
        status: "ARCHIVED",
      }),
    });
    const statusCountArgs = requirementGroupBy.mock.calls[0]?.[0] as
      | { where: { AND?: unknown[]; status?: unknown } }
      | undefined;
    const statusCountWhere = statusCountArgs?.where;

    expect(statusCountWhere).toEqual(
      expect.objectContaining({
        AND: expect.arrayContaining([
          {
            id: {
              in: [requirement.id],
            },
          },
        ]),
        spaceId: requirement.spaceId,
      }),
    );
    expect(statusCountWhere?.status).toBeUndefined();
    expect(JSON.stringify(statusCountWhere)).not.toContain("ARCHIVED");
  });

  it("scopes post-save aggregate queries by the saved requirement tenant", async () => {
    const requirement = makeRequirement();
    const saved = {
      ...requirement,
      status: "CONFIRMED" as const,
      title: "已保存需求",
    };
    const attachmentFindMany = vi.fn(async () => []);
    const workItemFindMany = vi.fn(async () => []);
    const bugDetailFindMany = vi.fn(async () => []);
    const tx = {
      requirement: {
        findFirst: vi
          .fn()
          .mockResolvedValueOnce(requirement)
          .mockResolvedValueOnce(saved),
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
      timelineEvent: {
        create: vi.fn(async () => undefined),
      },
    };
    const prisma = {
      client: {
        $transaction: vi.fn(async (handler) => handler(tx)),
        attachment: {
          findMany: attachmentFindMany,
        },
        bugDetail: {
          findMany: bugDetailFindMany,
        },
        tagAssignment: {
          findMany: vi.fn(async () => []),
        },
        workItem: {
          findMany: workItemFindMany,
        },
      },
    } as unknown as PrismaService;
    const repository = new PrismaRequirementRepository(prisma);

    await repository.save({
      requirementId: requirement.id,
      title: saved.title,
      contentJson: { type: "doc" },
      contentText: "需求内容",
      shouldUpdateOwner: false,
      updatedById: requirement.authorId,
    });

    expect(attachmentFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          organizationId: saved.organizationId,
          spaceId: saved.spaceId,
          targetId: saved.id,
          targetType: "REQUIREMENT",
        }),
      }),
    );
    expect(workItemFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([
            expect.objectContaining({
              organizationId: saved.organizationId,
              requirementId: {
                in: [saved.id],
              },
              spaceId: saved.spaceId,
            }),
          ]),
        }),
      }),
    );
    expect(bugDetailFindMany).not.toHaveBeenCalled();
  });

  it("includes bugs related through requirement tasks and de-duplicates direct matches", async () => {
    const requirement = makeRequirement();
    const task = makeWorkItem({
      id: "01H00000000000000000000009",
      requirementId: requirement.id,
      type: "TASK",
    });
    const relatedBug = makeWorkItem({
      id: "01H00000000000000000000010",
      requirementId: null,
      type: "BUG",
      bugDetail: {
        relatedTask: {
          organizationId: requirement.organizationId,
          requirementId: requirement.id,
          spaceId: requirement.spaceId,
        },
      },
    });
    const directAndRelatedBug = makeWorkItem({
      id: "01H00000000000000000000011",
      requirementId: requirement.id,
      type: "BUG",
      bugDetail: {
        relatedTask: {
          organizationId: requirement.organizationId,
          requirementId: requirement.id,
          spaceId: requirement.spaceId,
        },
      },
    });
    const workItemFindMany = vi.fn(async () => [task, directAndRelatedBug]);
    const bugDetailFindMany = vi.fn(async () => [
      {
        relatedTaskId: task.id,
        workItem: relatedBug,
      },
      {
        relatedTaskId: task.id,
        workItem: directAndRelatedBug,
      },
    ]);
    const prisma = {
      client: {
        attachment: {
          findMany: vi.fn(async () => []),
        },
        bugDetail: {
          findMany: bugDetailFindMany,
        },
        requirement: {
          findFirst: vi.fn(async () => requirement),
        },
        tagAssignment: {
          findMany: vi.fn(async () => []),
        },
        workItem: {
          findMany: workItemFindMany,
        },
      },
    } as unknown as PrismaService;
    const repository = new PrismaRequirementRepository(prisma);

    const result = await repository.findById(requirement.id);

    expect(result?.relatedWorkItems).toMatchObject({
      taskCount: 1,
      bugCount: 2,
      tasks: [expect.objectContaining({ id: task.id })],
      bugs: [
        expect.objectContaining({ id: relatedBug.id }),
        expect.objectContaining({ id: directAndRelatedBug.id }),
      ],
    });
    expect(bugDetailFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          deletedAt: null,
          relatedTaskId: {
            in: [task.id],
          },
          workItem: {
            deletedAt: null,
            type: "BUG",
          },
        }),
      }),
    );
  });

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
      tagAssignment: {
        updateMany: vi.fn(async () => ({ count: 0 })),
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
        tagAssignment: {
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

  it("writes assignee change timeline and syncs assignee participant when owner changes", async () => {
    const ownerId = "01H00000000000000000000006";
    const nextOwnerId = "01H00000000000000000000007";
    const previous = makeRequirement({ ownerId, status: "CONFIRMED" });
    const saved = {
      ...previous,
      ownerId: nextOwnerId,
      updatedById: previous.authorId,
    };
    const timelineEventCreate = vi.fn(async () => undefined);
    const objectParticipantCreate = vi.fn(async () => undefined);
    const objectParticipantUpdateMany = vi.fn(async () => ({ count: 1 }));
    const tx = {
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
        create: timelineEventCreate,
      },
    };
    const prisma = {
      client: {
        $transaction: vi.fn(async (handler) => handler(tx)),
        attachment: {
          findMany: vi.fn(async () => []),
        },
        tagAssignment: {
          findMany: vi.fn(async () => []),
        },
        workItem: {
          findMany: vi.fn(async () => []),
        },
      },
    } as unknown as PrismaService;
    const repository = new PrismaRequirementRepository(prisma);

    await repository.save({
      requirementId: previous.id,
      title: "已保存需求",
      contentJson: { type: "doc" },
      contentText: "需求内容",
      ownerId: nextOwnerId,
      shouldUpdateOwner: true,
      updatedById: previous.authorId,
    });

    expect(objectParticipantUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          relationType: "ASSIGNEE",
          targetId: previous.id,
          targetType: "REQUIREMENT",
          userId: {
            not: nextOwnerId,
          },
        }),
      }),
    );
    expect(objectParticipantCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        relationType: "ASSIGNEE",
        targetId: previous.id,
        targetType: "REQUIREMENT",
        userId: nextOwnerId,
      }),
    });
    expect(timelineEventCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        after: { ownerId: nextOwnerId },
        before: { ownerId },
        eventType: "ASSIGNEE_CHANGED",
        targetId: previous.id,
        targetType: "REQUIREMENT",
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
              id: taskId,
              organizationId: previous.organizationId,
              spaceId: previous.spaceId,
              versionId: oldVersionId,
            },
            {
              id: bugId,
              organizationId: previous.organizationId,
              spaceId: previous.spaceId,
              versionId: oldVersionId,
            },
          ])
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
        tagAssignment: {
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

function makeRequirement(overrides: Partial<RequirementRecord> = {}) {
  return {
    ...makeBaseRequirement(),
    ...overrides,
  };
}

type RequirementRecord = ReturnType<typeof makeBaseRequirement>;

function makeWorkItem(overrides: Partial<WorkItemRecord> = {}) {
  return {
    ...makeBaseWorkItem(),
    ...overrides,
  };
}

type WorkItemRecord = ReturnType<typeof makeBaseWorkItem>;

function makeBaseRequirement() {
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
    status: "DRAFT" as "DRAFT" | "CONFIRMED" | "ARCHIVED",
    priority: null,
    ownerId: null as string | null,
    authorId: "01H00000000000000000000005",
    createdAt: now,
    updatedAt: now,
  };
}

function makeBaseWorkItem() {
  const now = new Date("2026-05-14T12:00:00.000Z");

  return {
    id: "01H00000000000000000000009",
    organizationId: "01H00000000000000000000002",
    spaceId: "01H00000000000000000000003",
    versionId: "01H00000000000000000000004",
    requirementId: "01H00000000000000000000001" as string | null,
    intakeItemId: null as string | null,
    type: "TASK" as "TASK" | "BUG",
    title: "工作项",
    description: null,
    priority: "MEDIUM" as const,
    assigneeId: null as string | null,
    reporterId: "01H00000000000000000000005",
    workflowVersionId: "01H00000000000000000000019",
    currentStateId: "01H00000000000000000000020",
    statusCategory: "NOT_STARTED" as const,
    dueDate: null,
    lastStatusChangedAt: now,
    lastActionAt: null,
    blockedReason: null,
    blockedAt: null,
    closedAt: null,
    createdAt: now,
    updatedAt: now,
    createdById: "01H00000000000000000000005",
    updatedById: "01H00000000000000000000005",
    deletedAt: null,
    bugDetail: null as {
      relatedTask: {
        organizationId: string;
        requirementId: string | null;
        spaceId: string;
      } | null;
    } | null,
  };
}
