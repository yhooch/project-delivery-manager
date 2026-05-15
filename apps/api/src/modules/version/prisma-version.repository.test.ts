import { describe, expect, it, vi } from "vitest";

import type { PrismaService } from "../../prisma/prisma.service";
import { PrismaVersionRepository } from "./prisma-version.repository";

describe("PrismaVersionRepository", () => {
  it("writes VERSION timeline events when creating and updating versions", async () => {
    const version = makeVersionRecord();
    const updatedVersion = {
      ...version,
      status: "IN_PROGRESS",
      target: "Updated target",
    };
    const timelineEventCreate = vi.fn(async () => undefined);
    const tx = {
      timelineEvent: {
        create: timelineEventCreate,
      },
      version: {
        create: vi.fn(async () => version),
        findFirst: vi
          .fn()
          .mockResolvedValueOnce(version)
          .mockResolvedValueOnce(updatedVersion),
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
    };
    const prisma = {
      client: {
        $transaction: vi.fn(async (handler) => handler(tx)),
        requirement: {
          groupBy: vi.fn(async () => []),
        },
        workItem: {
          groupBy: vi.fn(async () => []),
        },
      },
    } as unknown as PrismaService;
    const repository = new PrismaVersionRepository(prisma);

    await repository.create({
      id: version.id,
      organizationId: version.organizationId,
      spaceId: version.spaceId,
      name: version.name,
      createdById: "01H00000000000000000000004",
    });
    await repository.update({
      versionId: version.id,
      status: "IN_PROGRESS",
      target: "Updated target",
      updatedById: "01H00000000000000000000004",
    });

    expect(timelineEventCreate).toHaveBeenCalledTimes(2);
    expect(timelineEventCreate).toHaveBeenNthCalledWith(1, {
      data: expect.objectContaining({
        actorId: "01H00000000000000000000004",
        eventType: "CREATED",
        targetId: version.id,
        targetType: "VERSION",
        title: "创建版本",
      }),
    });
    expect(timelineEventCreate).toHaveBeenNthCalledWith(2, {
      data: expect.objectContaining({
        actorId: "01H00000000000000000000004",
        eventType: "STATUS_CHANGED",
        targetId: version.id,
        targetType: "VERSION",
        title: "更新版本状态",
      }),
    });
  });

  it("computes version stats and blockedCount from current workflow state", async () => {
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
                currentState: {
                  is: {
                    OR: [
                      {
                        code: {
                          contains: "blocked",
                          mode: "insensitive",
                        },
                      },
                      {
                        name: {
                          contains: "blocked",
                          mode: "insensitive",
                        },
                      },
                      {
                        code: {
                          contains: "阻塞",
                          mode: "insensitive",
                        },
                      },
                      {
                        name: {
                          contains: "阻塞",
                          mode: "insensitive",
                        },
                      },
                    ],
                  },
                },
              },
            ],
          },
        ],
      },
    });
  });
});

function makeVersionRecord() {
  return {
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
    requirementCount: 0,
    taskCount: 0,
    bugCount: 0,
    blockedCount: 0,
  };
}
