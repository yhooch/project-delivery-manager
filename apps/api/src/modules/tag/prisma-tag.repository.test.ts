import { describe, expect, it, vi } from "vitest";

import type { PrismaService } from "../../prisma/prisma.service";
import { PrismaTagRepository } from "./prisma-tag.repository";

const ORGANIZATION_ID = "01H00000000000000000000000";
const SPACE_ID = "01H00000000000000000000001";
const TAG_ID = "01H00000000000000000000003";
const ORPHAN_TAG_ID = "01H00000000000000000000004";
const ACTOR_ID = "01H00000000000000000000005";
const SOURCE_TAG_ID = "01H00000000000000000000006";
const SECOND_SOURCE_TAG_ID = "01H00000000000000000000007";
const WORK_ITEM_ID = "01H00000000000000000000008";
const DOCUMENT_ID = "01H00000000000000000000009";

type TagRecord = {
  colorKey: string;
  createdAt: Date;
  id: string;
  name: string;
  normalizedName: string;
  organizationId: string;
  spaceId: string;
  updatedAt: Date;
};

describe("PrismaTagRepository", () => {
  it("lists tags with usage counts when requested", async () => {
    const tags = [
      makeTagRecord({ id: TAG_ID, name: "Blocked" }),
      makeTagRecord({ id: ORPHAN_TAG_ID, name: "Orphan" }),
    ];
    const tagFindMany = vi.fn(async () => tags);
    const tagCount = vi.fn(async () => 2);
    const tagAssignmentGroupBy = vi.fn(async () => [
      {
        tagId: TAG_ID,
        _count: {
          _all: 3,
        },
      },
    ]);
    const repository = new PrismaTagRepository({
      client: {
        $transaction: vi.fn(async (operations) => Promise.all(operations)),
        tag: {
          count: tagCount,
          findMany: tagFindMany,
        },
        tagAssignment: {
          groupBy: tagAssignmentGroupBy,
        },
      },
    } as unknown as PrismaService);

    const result = await repository.listBySpace({
      includeUsage: true,
      normalizedQuery: "block",
      organizationId: ORGANIZATION_ID,
      page: 1,
      pageSize: 20,
      spaceId: SPACE_ID,
    });

    expect(result).toMatchObject({
      page: 1,
      pageSize: 20,
      total: 2,
    });
    expect(result.items).toEqual([
      expect.objectContaining({
        id: TAG_ID,
        displayName: "#Blocked",
        usageCount: 3,
        isOrphan: false,
      }),
      expect.objectContaining({
        id: ORPHAN_TAG_ID,
        displayName: "#Orphan",
        usageCount: 0,
        isOrphan: true,
      }),
    ]);
    expect(tagFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          deletedAt: null,
          normalizedName: {
            contains: "block",
          },
          organizationId: ORGANIZATION_ID,
          spaceId: SPACE_ID,
        }),
      }),
    );
    expect(tagAssignmentGroupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        by: ["tagId"],
        where: {
          deletedAt: null,
          spaceId: SPACE_ID,
          tagId: {
            in: [TAG_ID, ORPHAN_TAG_ID],
          },
        },
      }),
    );
  });

  it("checks active assignments inside delete transaction before soft delete", async () => {
    const tag = makeTagRecord({ id: TAG_ID });
    const tagFindFirst = vi.fn(async () => tag);
    const tagAssignmentCount = vi.fn(async () => 1);
    const tagUpdateMany = vi.fn();
    const repository = new PrismaTagRepository({
      client: {
        $transaction: vi.fn(async (handler) =>
          handler({
            tag: {
              findFirst: tagFindFirst,
              updateMany: tagUpdateMany,
            },
            tagAssignment: {
              count: tagAssignmentCount,
            },
          }),
        ),
      },
    } as unknown as PrismaService);

    await expect(
      repository.softDeleteOrphan({
        tagId: TAG_ID,
        updatedById: ACTOR_ID,
      }),
    ).resolves.toEqual({ status: "in_use" });
    expect(tagAssignmentCount).toHaveBeenCalledWith({
      where: {
        deletedAt: null,
        tagId: TAG_ID,
      },
    });
    expect(tagUpdateMany).not.toHaveBeenCalled();
  });

  it("soft deletes orphan tags in the transaction", async () => {
    const tag = makeTagRecord({ id: TAG_ID });
    const tagUpdateMany = vi.fn(async () => ({ count: 1 }));
    const repository = new PrismaTagRepository({
      client: {
        $transaction: vi.fn(async (handler) =>
          handler({
            tag: {
              findFirst: vi.fn(async () => tag),
              updateMany: tagUpdateMany,
            },
            tagAssignment: {
              count: vi.fn(async () => 0),
            },
          }),
        ),
      },
    } as unknown as PrismaService);

    const result = await repository.softDeleteOrphan({
      tagId: TAG_ID,
      updatedById: ACTOR_ID,
    });

    expect(result).toMatchObject({
      status: "deleted",
      tag: expect.objectContaining({ id: TAG_ID }),
    });
    expect(tagUpdateMany).toHaveBeenCalledWith({
      data: {
        deletedAt: expect.any(Date),
        updatedById: ACTOR_ID,
      },
      where: {
        assignments: {
          none: {
            deletedAt: null,
          },
        },
        deletedAt: null,
        id: TAG_ID,
      },
    });
  });

  it("returns in_use when a concurrent active assignment blocks conditional delete", async () => {
    const tag = makeTagRecord({ id: TAG_ID });
    const tagFindFirst = vi
      .fn()
      .mockResolvedValueOnce(tag)
      .mockResolvedValueOnce({ id: TAG_ID });
    const repository = new PrismaTagRepository({
      client: {
        $transaction: vi.fn(async (handler) =>
          handler({
            tag: {
              findFirst: tagFindFirst,
              updateMany: vi.fn(async () => ({ count: 0 })),
            },
            tagAssignment: {
              count: vi.fn(async () => 0),
            },
          }),
        ),
      },
    } as unknown as PrismaService);

    await expect(
      repository.softDeleteOrphan({
        tagId: TAG_ID,
        updatedById: ACTOR_ID,
      }),
    ).resolves.toEqual({ status: "in_use" });
    expect(tagFindFirst).toHaveBeenCalledTimes(2);
  });

  it("merges source tag assignments into the target tag and soft deletes sources", async () => {
    const sourceAssignments = [
      makeAssignment({
        id: "assignment-source-1",
        tagId: SOURCE_TAG_ID,
        targetId: WORK_ITEM_ID,
        targetType: "WORK_ITEM",
      }),
      makeAssignment({
        id: "assignment-source-2",
        tagId: SECOND_SOURCE_TAG_ID,
        targetId: WORK_ITEM_ID,
        targetType: "WORK_ITEM",
      }),
      makeAssignment({
        id: "assignment-source-3",
        tagId: SOURCE_TAG_ID,
        targetId: DOCUMENT_ID,
        targetType: "DOCUMENT",
      }),
    ];
    const existingTargetAssignments = [
      makeAssignment({
        deletedAt: new Date("2026-05-20T00:00:00.000Z"),
        id: "assignment-target-restorable",
        tagId: TAG_ID,
        targetId: WORK_ITEM_ID,
        targetType: "WORK_ITEM",
      }),
      makeAssignment({
        id: "assignment-target-active",
        tagId: TAG_ID,
        targetId: DOCUMENT_ID,
        targetType: "DOCUMENT",
      }),
    ];
    const tagAssignmentFindMany = vi
      .fn()
      .mockResolvedValueOnce(sourceAssignments)
      .mockResolvedValueOnce(existingTargetAssignments);
    const tagAssignmentUpdate = vi.fn(async () => undefined);
    const tagAssignmentCreate = vi.fn(async () => undefined);
    const tagAssignmentUpdateMany = vi.fn(async () => ({ count: 3 }));
    const tagUpdateMany = vi.fn(async () => ({ count: 2 }));
    const timelineEventCreate = vi.fn(async () => undefined);
    const repository = new PrismaTagRepository({
      client: {
        $transaction: vi.fn(async (handler) =>
          handler({
            $queryRaw: vi.fn(async () => [
              makeTagRecord({ id: TAG_ID, name: "Target" }),
              makeTagRecord({ id: SOURCE_TAG_ID, name: "Source" }),
              makeTagRecord({ id: SECOND_SOURCE_TAG_ID, name: "Old Source" }),
            ]),
            tag: {
              updateMany: tagUpdateMany,
            },
            tagAssignment: {
              create: tagAssignmentCreate,
              findMany: tagAssignmentFindMany,
              update: tagAssignmentUpdate,
              updateMany: tagAssignmentUpdateMany,
            },
            timelineEvent: {
              create: timelineEventCreate,
            },
          }),
        ),
      },
    } as unknown as PrismaService);

    const result = await repository.merge({
      dryRun: false,
      organizationId: ORGANIZATION_ID,
      spaceId: SPACE_ID,
      sourceTagIds: [SOURCE_TAG_ID, SECOND_SOURCE_TAG_ID],
      targetTagId: TAG_ID,
      updatedById: ACTOR_ID,
    });

    expect(result).toMatchObject({
      dryRun: false,
      sourceAssignmentsRemoved: 3,
      targetAssignmentsCreated: 1,
      duplicateAssignmentsSkipped: 2,
      deletedSourceTags: 2,
      affectedTargetsByType: [
        { targetType: "WORK_ITEM", count: 1 },
        { targetType: "DOCUMENT", count: 1 },
      ],
      targetTag: expect.objectContaining({ id: TAG_ID }),
    });
    expect(result?.sourceTags.map((tag) => tag.id)).toEqual([
      SOURCE_TAG_ID,
      SECOND_SOURCE_TAG_ID,
    ]);
    expect(tagAssignmentUpdate).toHaveBeenCalledWith({
      data: {
        assignedById: ACTOR_ID,
        deletedAt: null,
      },
      where: {
        id: "assignment-target-restorable",
      },
    });
    expect(tagAssignmentCreate).not.toHaveBeenCalled();
    expect(tagAssignmentUpdateMany).toHaveBeenCalledWith({
      data: {
        deletedAt: expect.any(Date),
      },
      where: {
        deletedAt: null,
        id: {
          in: [
            "assignment-source-1",
            "assignment-source-2",
            "assignment-source-3",
          ],
        },
      },
    });
    expect(tagUpdateMany).toHaveBeenCalledWith({
      data: {
        deletedAt: expect.any(Date),
        updatedById: ACTOR_ID,
      },
      where: {
        deletedAt: null,
        id: {
          in: [SOURCE_TAG_ID, SECOND_SOURCE_TAG_ID],
        },
        organizationId: ORGANIZATION_ID,
        spaceId: SPACE_ID,
      },
    });
    expect(timelineEventCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorId: ACTOR_ID,
        after: expect.objectContaining({
          affectedTargetsByType: [
            { targetType: "WORK_ITEM", count: 1 },
            { targetType: "DOCUMENT", count: 1 },
          ],
          deletedSourceTags: 2,
          duplicateAssignmentsSkipped: 2,
          operation: "MERGE_TAGS",
          sourceAssignmentsRemoved: 3,
          sourceTagIds: [SOURCE_TAG_ID, SECOND_SOURCE_TAG_ID],
          targetAssignmentsCreated: 1,
          targetTagId: TAG_ID,
        }),
        before: expect.objectContaining({
          sourceTags: expect.arrayContaining([
            expect.objectContaining({ id: SOURCE_TAG_ID }),
            expect.objectContaining({ id: SECOND_SOURCE_TAG_ID }),
          ]),
          targetTag: expect.objectContaining({ id: TAG_ID }),
        }),
        createdById: ACTOR_ID,
        detail: "将 #Source, #Old Source 合并到 #Target",
        eventType: "UPDATED",
        metadata: expect.objectContaining({
          affectedTargetsByType: [
            { targetType: "WORK_ITEM", count: 1 },
            { targetType: "DOCUMENT", count: 1 },
          ],
          deletedSourceTags: 2,
          duplicateAssignmentsSkipped: 2,
          operation: "MERGE_TAGS",
          sourceAssignmentsRemoved: 3,
          sourceTagIds: [SOURCE_TAG_ID, SECOND_SOURCE_TAG_ID],
          targetAssignmentsCreated: 1,
          targetTagId: TAG_ID,
        }),
        organizationId: ORGANIZATION_ID,
        spaceId: SPACE_ID,
        targetId: SPACE_ID,
        targetType: "SPACE",
        title: "合并标签",
        updatedById: ACTOR_ID,
      }),
    });
  });

  it("returns merge dry-run statistics without writes", async () => {
    const tagAssignmentUpdateMany = vi.fn();
    const tagUpdateMany = vi.fn();
    const timelineEventCreate = vi.fn();
    const repository = new PrismaTagRepository({
      client: {
        $transaction: vi.fn(async (handler) =>
          handler({
            $queryRaw: vi.fn(async () => [
              makeTagRecord({ id: TAG_ID, name: "Target" }),
              makeTagRecord({ id: SOURCE_TAG_ID, name: "Source" }),
            ]),
            tag: {
              updateMany: tagUpdateMany,
            },
            tagAssignment: {
              create: vi.fn(),
              findMany: vi
                .fn()
                .mockResolvedValueOnce([
                  makeAssignment({
                    tagId: SOURCE_TAG_ID,
                    targetId: WORK_ITEM_ID,
                    targetType: "WORK_ITEM",
                  }),
                ])
                .mockResolvedValueOnce([]),
              update: vi.fn(),
              updateMany: tagAssignmentUpdateMany,
            },
            timelineEvent: {
              create: timelineEventCreate,
            },
          }),
        ),
      },
    } as unknown as PrismaService);

    const result = await repository.merge({
      dryRun: true,
      organizationId: ORGANIZATION_ID,
      spaceId: SPACE_ID,
      sourceTagIds: [SOURCE_TAG_ID],
      targetTagId: TAG_ID,
      updatedById: ACTOR_ID,
    });

    expect(result).toMatchObject({
      dryRun: true,
      sourceAssignmentsRemoved: 1,
      targetAssignmentsCreated: 1,
      duplicateAssignmentsSkipped: 0,
      deletedSourceTags: 1,
    });
    expect(tagAssignmentUpdateMany).not.toHaveBeenCalled();
    expect(tagUpdateMany).not.toHaveBeenCalled();
    expect(timelineEventCreate).not.toHaveBeenCalled();
  });

  it("returns undefined when merge tags are not all active in the space", async () => {
    const tagAssignmentFindMany = vi.fn();
    const repository = new PrismaTagRepository({
      client: {
        $transaction: vi.fn(async (handler) =>
          handler({
            $queryRaw: vi.fn(async () => [
              makeTagRecord({ id: TAG_ID, name: "Target" }),
            ]),
            tagAssignment: {
              findMany: tagAssignmentFindMany,
            },
          }),
        ),
      },
    } as unknown as PrismaService);

    await expect(
      repository.merge({
        dryRun: false,
        organizationId: ORGANIZATION_ID,
        spaceId: SPACE_ID,
        sourceTagIds: [SOURCE_TAG_ID],
        targetTagId: TAG_ID,
        updatedById: ACTOR_ID,
      }),
    ).resolves.toBeUndefined();
    expect(tagAssignmentFindMany).not.toHaveBeenCalled();
  });
});

function makeTagRecord(input: Partial<TagRecord> = {}): TagRecord {
  const name = input.name ?? "Blocked";

  return {
    id: input.id ?? TAG_ID,
    organizationId: input.organizationId ?? ORGANIZATION_ID,
    spaceId: input.spaceId ?? SPACE_ID,
    name,
    normalizedName: input.normalizedName ?? name.toLocaleLowerCase("en-US"),
    colorKey: input.colorKey ?? "blue",
    createdAt: input.createdAt ?? new Date("2026-05-19T00:00:00.000Z"),
    updatedAt: input.updatedAt ?? new Date("2026-05-19T00:00:00.000Z"),
  };
}

function makeAssignment(
  input: {
    deletedAt?: Date | null;
    id?: string;
    tagId?: string;
    targetId?: string;
    targetType?: "INTAKE_ITEM" | "WORK_ITEM" | "DOCUMENT";
  } = {},
) {
  return {
    id: input.id ?? "assignment-1",
    organizationId: ORGANIZATION_ID,
    spaceId: SPACE_ID,
    tagId: input.tagId ?? TAG_ID,
    targetType: input.targetType ?? "WORK_ITEM",
    targetId: input.targetId ?? WORK_ITEM_ID,
    assignedById: ACTOR_ID,
    createdAt: new Date("2026-05-19T00:00:00.000Z"),
    updatedAt: new Date("2026-05-19T00:00:00.000Z"),
    deletedAt: input.deletedAt ?? null,
  };
}
