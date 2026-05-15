import { describe, expect, it, vi } from "vitest";

import type { PrismaService } from "../../prisma/prisma.service";
import { PrismaVersionRepository } from "./prisma-version.repository";

describe("PrismaVersionRepository", () => {
  it("computes version stats from live requirement and work item records", async () => {
    const version = {
      id: "01H00000000000000000000001",
      organizationId: "01H00000000000000000000002",
      spaceId: "01H00000000000000000000003",
      name: "M1",
      target: null,
      description: null,
      ownerId: null,
      status: "PLANNED",
      startDate: null,
      targetDate: null,
      releaseDate: null,
      requirementCount: 99,
      taskCount: 99,
      bugCount: 99,
      blockedCount: 99,
    };
    const workItemGroupBy = vi
      .fn()
      .mockResolvedValueOnce([
        { versionId: version.id, type: "TASK", _count: { _all: 2 } },
        { versionId: version.id, type: "BUG", _count: { _all: 1 } },
      ])
      .mockResolvedValueOnce([
        { versionId: version.id, _count: { _all: 1 } },
      ]);
    const prisma = {
      client: {
        requirement: {
          groupBy: vi.fn(async () => [
            { versionId: version.id, _count: { _all: 3 } },
          ]),
        },
        version: {
          findFirst: vi.fn(async () => version),
        },
        workItem: {
          groupBy: workItemGroupBy,
        },
      },
    } as unknown as PrismaService;
    const repository = new PrismaVersionRepository(prisma);

    const result = await repository.findById(version.id);

    expect(result?.stats).toEqual({
      requirementCount: 3,
      taskCount: 2,
      bugCount: 1,
      blockedCount: 1,
    });
    expect(workItemGroupBy).toHaveBeenNthCalledWith(1, {
      by: ["versionId", "type"],
      _count: {
        _all: true,
      },
      where: {
        deletedAt: null,
        versionId: {
          in: [version.id],
        },
        OR: [
          {
            type: "TASK",
          },
          {
            bugDetail: {
              is: {
                deletedAt: null,
              },
            },
            type: "BUG",
          },
        ],
      },
    });
    expect(workItemGroupBy).toHaveBeenNthCalledWith(2, {
      by: ["versionId"],
      _count: {
        _all: true,
      },
      where: {
        AND: [
          {
            deletedAt: null,
            versionId: {
              in: [version.id],
            },
            OR: [
              {
                type: "TASK",
              },
              {
                bugDetail: {
                  is: {
                    deletedAt: null,
                  },
                },
                type: "BUG",
              },
            ],
          },
          {
            OR: [
              {
                blockedAt: {
                  not: null,
                },
              },
              {
                blockedReason: {
                  not: null,
                },
              },
            ],
          },
        ],
      },
    });
  });
});
