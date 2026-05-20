import { describe, expect, it, vi } from "vitest";

import type { PrismaService } from "../../prisma/prisma.service";
import { PrismaTagRepository } from "./prisma-tag.repository";

const ORGANIZATION_ID = "01H00000000000000000000000";
const SPACE_ID = "01H00000000000000000000001";
const TAG_ID = "01H00000000000000000000003";
const ORPHAN_TAG_ID = "01H00000000000000000000004";
const ACTOR_ID = "01H00000000000000000000005";

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
