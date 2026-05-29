import { describe, expect, it, vi } from "vitest";

import type { ObjectCodeAllocator } from "../object-code/object-code.allocator";
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
        document: {
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
    const repository = new PrismaRequirementRepository(
      prisma,
      makeObjectCodeAllocator(),
    );

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
        targetType: "DOCUMENT",
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
        sequence: true,
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

  it("does not allocate sequence when creating an empty draft", async () => {
    const requirement = makeRequirement({ sequence: null, status: "DRAFT" });
    const objectCodeAllocator = makeObjectCodeAllocator();
    const requirementCreate = vi.fn(
      async (_args: { data: Record<string, unknown> }) => requirement,
    );
    const tx = {
      ...makeDocumentMutationStores(),
      objectParticipant: {
        create: vi.fn(async () => undefined),
        findFirst: vi.fn(async () => undefined),
      },
      document: {
        create: requirementCreate,
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
      },
    } as unknown as PrismaService;
    const repository = new PrismaRequirementRepository(
      prisma,
      objectCodeAllocator,
    );

    const created = await repository.createDraft({
      id: requirement.id,
      organizationId: requirement.organizationId,
      spaceId: requirement.spaceId,
      createdById: requirement.authorId,
    });

    expect(objectCodeAllocator.allocateOne).not.toHaveBeenCalled();
    const createArgs = (
      requirementCreate.mock.calls as Array<[{ data: Record<string, unknown> }]>
    )[0]?.[0];

    expect(createArgs?.data).not.toHaveProperty("sequence");
    expect(createArgs?.data).toMatchObject({
      contentFormat: "TIPTAP_JSON",
      kind: "REQUIREMENT",
      sourceType: "USER_CREATED",
      status: "DRAFT",
    });
    expect(created.sequence).toBeUndefined();
  });

  it("persists and maps Markdown draft content format", async () => {
    const requirement = makeRequirement({
      contentFormat: "MARKDOWN",
      contentMarkdown: "",
      contentJson: {},
      sequence: null,
      status: "DRAFT",
    });
    const requirementCreate = vi.fn(
      async (_args: { data: Record<string, unknown> }) => requirement,
    );
    const tx = {
      ...makeDocumentMutationStores(),
      objectParticipant: {
        create: vi.fn(async () => undefined),
        findFirst: vi.fn(async () => undefined),
      },
      document: {
        create: requirementCreate,
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
      },
    } as unknown as PrismaService;
    const repository = new PrismaRequirementRepository(
      prisma,
      makeObjectCodeAllocator(),
    );

    const created = await repository.createDraft({
      id: requirement.id,
      organizationId: requirement.organizationId,
      spaceId: requirement.spaceId,
      contentFormat: "MARKDOWN",
      createdById: requirement.authorId,
    });
    const createArgs = (
      requirementCreate.mock.calls as Array<[{ data: Record<string, unknown> }]>
    )[0]?.[0];

    expect(createArgs?.data).toMatchObject({
      contentFormat: "MARKDOWN",
      contentMarkdown: "",
      kind: "REQUIREMENT",
      sourceType: "USER_CREATED",
    });
    expect(created).toMatchObject({
      contentFormat: "MARKDOWN",
      contentMarkdown: "",
      status: "DRAFT",
    });
    expect(created).not.toHaveProperty("contentJson");
    expect(created).not.toHaveProperty("contentMarkdownCache");
  });

  it("allocates a requirement sequence on first save only", async () => {
    const previous = makeRequirement({ sequence: null, status: "DRAFT" });
    const saved = makeRequirement({
      ...previous,
      sequence: 12,
      status: "ACTIVE",
      title: "已保存需求",
    });
    const objectCodeAllocator = makeObjectCodeAllocator({ nextSequence: 12 });
    const requirementUpdateMany = vi.fn(async () => ({ count: 1 }));
    const tx = {
      ...makeDocumentMutationStores(),
      document: {
        findFirst: vi
          .fn()
          .mockResolvedValueOnce(previous)
          .mockResolvedValueOnce(saved),
        updateMany: requirementUpdateMany,
      },
      timelineEvent: {
        create: vi.fn(async () => undefined),
      },
    };
    const prisma = {
      client: {
        $transaction: vi.fn(async (handler) => handler(tx)),
        attachment: {
          findMany: vi.fn(async () => []),
        },
        bugDetail: {
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
    const repository = new PrismaRequirementRepository(
      prisma,
      objectCodeAllocator,
    );

    const result = await repository.save({
      baseRevision: previous.revision,
      requirementId: previous.id,
      title: saved.title,
      contentFormat: "TIPTAP_JSON",
      contentJson: { type: "doc" },
      contentText: "已保存需求",
      shouldUpdateOwner: false,
      updatedById: previous.authorId,
    });

    expect(objectCodeAllocator.allocateOne).toHaveBeenCalledWith(tx, {
      actorUserId: previous.authorId,
      objectType: "REQUIREMENT",
      organizationId: previous.organizationId,
      spaceId: previous.spaceId,
    });
    expect(requirementUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ sequence: 12 }),
        where: expect.objectContaining({
          id: previous.id,
          revision: previous.revision,
        }),
      }),
    );
    expect(tx.documentCodeHistory.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          codePrefix: "REQ",
          codeStatus: "ASSIGNED",
          displayCode: "REQ-12",
          documentId: previous.id,
          kind: "REQUIREMENT",
          organizationId: previous.organizationId,
          sequence: 12,
          spaceId: previous.spaceId,
        }),
      ],
      skipDuplicates: true,
    });
    expect(result).toMatchObject({
      sequence: 12,
      displayCode: "REQ-12",
    });
  });

  it("keeps an existing requirement sequence unchanged on later saves", async () => {
    const previous = makeRequirement({
      sequence: 12,
      status: "ACTIVE",
    });
    const saved = makeRequirement({
      ...previous,
      title: "再次保存需求",
    });
    const objectCodeAllocator = makeObjectCodeAllocator();
    const requirementUpdateMany = vi.fn(async () => ({ count: 1 }));
    const tx = {
      ...makeDocumentMutationStores(),
      document: {
        findFirst: vi
          .fn()
          .mockResolvedValueOnce(previous)
          .mockResolvedValueOnce(saved),
        updateMany: requirementUpdateMany,
      },
      timelineEvent: {
        create: vi.fn(async () => undefined),
      },
    };
    const prisma = {
      client: {
        $transaction: vi.fn(async (handler) => handler(tx)),
        attachment: {
          findMany: vi.fn(async () => []),
        },
        bugDetail: {
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
    const repository = new PrismaRequirementRepository(
      prisma,
      objectCodeAllocator,
    );

    const result = await repository.save({
      baseRevision: previous.revision,
      requirementId: previous.id,
      title: saved.title,
      contentFormat: "TIPTAP_JSON",
      contentJson: { type: "doc" },
      contentText: "再次保存需求",
      shouldUpdateOwner: false,
      updatedById: previous.authorId,
    });

    expect(objectCodeAllocator.allocateOne).not.toHaveBeenCalled();
    expect(requirementUpdateMany).toHaveBeenCalledTimes(1);
    expect(tx.documentCodeHistory.createMany).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      sequence: 12,
      displayCode: "REQ-12",
    });
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
        document: {
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
    const repository = new PrismaRequirementRepository(
      prisma,
      makeObjectCodeAllocator(),
    );

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
        targetType: "DOCUMENT",
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
        sequence: true,
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
        status: "ACTIVE",
      },
    ]);
    const prisma = {
      client: {
        $transaction: vi.fn(async (queries) => Promise.all(queries)),
        objectParticipant: {
          findMany: vi.fn(async () => []),
        },
        document: {
          count: requirementCount,
          findMany: requirementFindMany,
          groupBy: requirementGroupBy,
        },
        tagAssignment: {
          findMany: tagAssignmentFindMany,
        },
      },
    } as unknown as PrismaService;
    const repository = new PrismaRequirementRepository(
      prisma,
      makeObjectCodeAllocator(),
    );

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
        status: "ACTIVE",
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
        targetType: "DOCUMENT",
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
          kind: "REQUIREMENT",
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
        kind: "REQUIREMENT",
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
        kind: "REQUIREMENT",
        spaceId: requirement.spaceId,
      }),
    );
    expect(statusCountWhere?.status).toBeUndefined();
    expect(JSON.stringify(statusCountWhere)).not.toContain("ARCHIVED");
  });

  it("checks requirement cascade impact against requirement documents", async () => {
    const requirement = makeRequirement();
    const documentFindFirst = vi.fn(async () => undefined);
    const intakeFindMany = vi.fn(async () => []);
    const workItemFindMany = vi.fn(async () => []);
    const prisma = {
      client: {
        document: {
          findFirst: documentFindFirst,
        },
        intakeItem: {
          findMany: intakeFindMany,
        },
        workItem: {
          findMany: workItemFindMany,
        },
      },
    } as unknown as PrismaService;
    const repository = new PrismaRequirementRepository(
      prisma,
      makeObjectCodeAllocator(),
    );

    await expect(
      repository.countVersionCascadeImpact({
        requirementId: requirement.id,
        nextVersionId: requirement.versionId,
      }),
    ).resolves.toEqual({
      bugCount: 0,
      bugIds: [],
      intakeItemCount: 0,
      intakeItemIds: [],
      relatedBugCount: 0,
      relatedBugIds: [],
      workItemCount: 0,
      workItemIds: [],
    });
    expect(documentFindFirst).toHaveBeenCalledWith({
      select: {
        id: true,
      },
      where: {
        deletedAt: null,
        id: requirement.id,
        kind: "REQUIREMENT",
      },
    });
    expect(intakeFindMany).not.toHaveBeenCalled();
    expect(workItemFindMany).not.toHaveBeenCalled();
  });

  it("scopes post-save aggregate queries by the saved requirement tenant", async () => {
    const requirement = makeRequirement();
    const saved = {
      ...requirement,
      status: "ACTIVE" as const,
      title: "已保存需求",
    };
    const attachmentFindMany = vi.fn(async () => []);
    const workItemFindMany = vi.fn(async () => []);
    const bugDetailFindMany = vi.fn(async () => []);
    const tx = {
      ...makeDocumentMutationStores(),
      document: {
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
    const repository = new PrismaRequirementRepository(
      prisma,
      makeObjectCodeAllocator(),
    );

    await repository.save({
      baseRevision: requirement.revision,
      requirementId: requirement.id,
      title: saved.title,
      contentFormat: "TIPTAP_JSON",
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
          targetType: "DOCUMENT",
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

  it("stores Markdown source content without keeping a Tiptap cache as source", async () => {
    const previous = makeRequirement({ status: "DRAFT" });
    const saved = makeRequirement({
      ...previous,
      contentFormat: "MARKDOWN",
      contentJson: {},
      contentMarkdown: "# 范围\n\n交付 Markdown 需求。",
      contentMarkdownCache: null,
      contentText: "范围\n\n交付 Markdown 需求。",
      status: "ACTIVE",
      title: "Markdown 需求",
    });
    const requirementUpdateMany = vi.fn(async () => ({ count: 1 }));
    const tx = {
      ...makeDocumentMutationStores(),
      document: {
        findFirst: vi
          .fn()
          .mockResolvedValueOnce(previous)
          .mockResolvedValueOnce(saved),
        updateMany: requirementUpdateMany,
      },
      timelineEvent: {
        create: vi.fn(async () => undefined),
      },
    };
    const prisma = {
      client: {
        $transaction: vi.fn(async (handler) => handler(tx)),
        attachment: {
          findMany: vi.fn(async () => []),
        },
        bugDetail: {
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
    const repository = new PrismaRequirementRepository(
      prisma,
      makeObjectCodeAllocator(),
    );

    const result = await repository.save({
      baseRevision: previous.revision,
      requirementId: previous.id,
      title: "Markdown 需求",
      contentFormat: "MARKDOWN",
      contentMarkdown: "# 范围\n\n交付 Markdown 需求。",
      contentText: "范围\n\n交付 Markdown 需求。",
      shouldUpdateOwner: false,
      updatedById: previous.authorId,
    });

    expect(requirementUpdateMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        data: expect.objectContaining({
          contentFormat: "MARKDOWN",
          contentJson: expect.anything(),
          contentMarkdown: "# 范围\n\n交付 Markdown 需求。",
          contentMarkdownCache: null,
          contentText: "范围\n\n交付 Markdown 需求。",
        }),
      }),
    );
    expect(tx.documentRevision.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        changeType: "CONTENT_EDITED",
        contentFormat: "MARKDOWN",
        contentMarkdown: "# 范围\n\n交付 Markdown 需求。",
        contentText: "范围\n\n交付 Markdown 需求。",
        documentId: previous.id,
        kind: "REQUIREMENT",
      }),
    });
    expect(tx.documentChunk.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({
          contentText: "交付 Markdown 需求。",
          documentId: previous.id,
          headingPath: "范围",
        }),
      ]),
    });
    expect(result).toMatchObject({
      contentFormat: "MARKDOWN",
      contentMarkdown: "# 范围\n\n交付 Markdown 需求。",
      contentText: "范围\n\n交付 Markdown 需求。",
    });
    expect(result).not.toHaveProperty("contentJson");
    expect(result).not.toHaveProperty("contentMarkdownCache");
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
        document: {
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
    const repository = new PrismaRequirementRepository(
      prisma,
      makeObjectCodeAllocator(),
    );

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
      ...makeDocumentMutationStores(),
      objectParticipant: {
        create: vi.fn(async () => undefined),
        findFirst: vi.fn(async () => undefined),
        updateMany: vi.fn(async () => undefined),
      },
      document: {
        create: vi.fn(async () => requirement),
        findFirst: vi
          .fn()
          .mockResolvedValueOnce(requirement)
          .mockResolvedValueOnce({
            ...requirement,
            title: "已保存需求",
            status: "ACTIVE",
          })
          .mockResolvedValueOnce({
            ...requirement,
            title: "已保存需求",
            status: "ACTIVE",
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
    const repository = new PrismaRequirementRepository(
      prisma,
      makeObjectCodeAllocator(),
    );

    await repository.createDraft({
      id: requirement.id,
      organizationId: requirement.organizationId,
      spaceId: requirement.spaceId,
      versionId: requirement.versionId ?? undefined,
      createdById: requirement.authorId,
    });
    await repository.save({
      baseRevision: requirement.revision,
      requirementId: requirement.id,
      title: "已保存需求",
      contentFormat: "TIPTAP_JSON",
      contentJson: { type: "doc" },
      contentText: "需求内容",
      shouldUpdateOwner: false,
      updatedById: requirement.authorId,
    });
    await repository.archive({
      baseRevision: requirement.revision + 1,
      requirementId: requirement.id,
      updatedById: requirement.authorId,
    });

    expect(timelineEventCreate).toHaveBeenCalledTimes(3);
    expect(timelineEventCreate).toHaveBeenNthCalledWith(1, {
      data: expect.objectContaining({
        actorId: requirement.authorId,
        eventType: "CREATED",
        targetId: requirement.id,
        targetType: "DOCUMENT",
        title: "创建需求草稿",
      }),
    });
    expect(timelineEventCreate).toHaveBeenNthCalledWith(2, {
      data: expect.objectContaining({
        actorId: requirement.authorId,
        eventType: "UPDATED",
        targetId: requirement.id,
        targetType: "DOCUMENT",
        title: "保存需求",
      }),
    });
    expect(timelineEventCreate).toHaveBeenNthCalledWith(3, {
      data: expect.objectContaining({
        actorId: requirement.authorId,
        eventType: "STATUS_CHANGED",
        targetId: requirement.id,
        targetType: "DOCUMENT",
        title: "归档需求",
      }),
    });
  });

  it("writes assignee change timeline and syncs assignee participant when owner changes", async () => {
    const ownerId = "01H00000000000000000000006";
    const nextOwnerId = "01H00000000000000000000007";
    const previous = makeRequirement({ ownerId, status: "ACTIVE" });
    const saved = {
      ...previous,
      ownerId: nextOwnerId,
      updatedById: previous.authorId,
    };
    const timelineEventCreate = vi.fn(async () => undefined);
    const objectParticipantCreate = vi.fn(async () => undefined);
    const objectParticipantUpdateMany = vi.fn(async () => ({ count: 1 }));
    const tx = {
      ...makeDocumentMutationStores(),
      objectParticipant: {
        create: objectParticipantCreate,
        findFirst: vi.fn(async () => undefined),
        updateMany: objectParticipantUpdateMany,
      },
      document: {
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
    const repository = new PrismaRequirementRepository(
      prisma,
      makeObjectCodeAllocator(),
    );

    await repository.save({
      baseRevision: previous.revision,
      requirementId: previous.id,
      title: "已保存需求",
      contentFormat: "TIPTAP_JSON",
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
          targetType: "DOCUMENT",
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
        targetType: "DOCUMENT",
        userId: nextOwnerId,
      }),
    });
    expect(timelineEventCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        after: { ownerId: nextOwnerId },
        before: { ownerId },
        eventType: "ASSIGNEE_CHANGED",
        targetId: previous.id,
        targetType: "DOCUMENT",
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
      status: "ACTIVE" as const,
      updatedById: actorUserId,
      versionId: newVersionId,
    };
    const objectParticipantUpdateMany = vi.fn(async () => ({ count: 1 }));
    const objectParticipantCreate = vi.fn(async () => undefined);
    const tx = {
      ...makeDocumentMutationStores(),
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
      document: {
        findFirst: vi
          .fn()
          .mockResolvedValueOnce(previous)
          .mockResolvedValueOnce(saved),
        findMany: vi
          .fn()
          .mockResolvedValueOnce([{ id: previous.id, versionId: newVersionId }])
          .mockResolvedValueOnce([{ id: previous.id, ownerId: null }]),
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
              requirementId: null,
            },
          ])
          .mockResolvedValueOnce([
            {
              bugDetail: null,
              id: taskId,
              intakeItem: null,
              organizationId: previous.organizationId,
              requirementId: previous.id,
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
              requirementId: null,
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
    const repository = new PrismaRequirementRepository(
      prisma,
      makeObjectCodeAllocator(),
    );

    await repository.save({
      baseRevision: previous.revision,
      cascadeVersionChange: true,
      contentFormat: "TIPTAP_JSON",
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

function makeDocumentMutationStores() {
  return {
    documentChunk: {
      createMany: vi.fn(async () => ({ count: 0 })),
      deleteMany: vi.fn(async () => ({ count: 0 })),
    },
    documentCodeHistory: {
      createMany: vi.fn(async () => ({ count: 1 })),
    },
    documentRevision: {
      create: vi.fn(async () => undefined),
    },
  };
}

function makeBaseRequirement() {
  const now = new Date("2026-05-14T12:00:00.000Z");

  return {
    id: "01H00000000000000000000001",
    organizationId: "01H00000000000000000000002",
    spaceId: "01H00000000000000000000003",
    kind: "REQUIREMENT" as const,
    versionId: "01H00000000000000000000004",
    title: "",
    summary: null,
    contentJson: {},
    contentMarkdown: null as string | null,
    contentText: "",
    contentMarkdownCache: null as string | null,
    contentFormat: "TIPTAP_JSON" as "TIPTAP_JSON" | "MARKDOWN",
    status: "DRAFT" as "DRAFT" | "ACTIVE" | "ARCHIVED",
    priority: null,
    ownerId: null as string | null,
    authorId: "01H00000000000000000000005",
    sequence: null as number | null,
    revision: 1,
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
    sequence: null as number | null,
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
