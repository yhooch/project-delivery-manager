import type {
  GetSpaceOverviewViewResponse,
  Space,
} from "@project-delivery/shared";
import { describe, expect, it, vi } from "vitest";

import type { PrismaService } from "../../prisma/prisma.service";
import { PrismaSpaceRepository } from "./prisma-space.repository";

type RepositoryInternals = {
  findCurrentVersion(spaceId: string): Promise<undefined>;
  findVersionById(spaceId: string, versionId: string): Promise<undefined>;
  getExceptionCounts(...args: unknown[]): Promise<unknown[]>;
  listDefaultWorkflows(spaceId: string): Promise<unknown[]>;
  pageRecentActivities(
    ...args: unknown[]
  ): Promise<GetSpaceOverviewViewResponse["recentActivities"]>;
  resolveViewAccessContext(...args: unknown[]): Promise<{
    accessBySpaceId: Map<string, unknown>;
    accesses: unknown[];
    participantSpaceIds: string[];
    participantWorkItemIds: string[];
    readAllSpaceIds: string[];
    spaceIds: string[];
  }>;
};

describe("PrismaSpaceRepository", () => {
  it("groups overview status counts by all visible items and then by task/bug type", async () => {
    const organizationId = "01ARZ3NDEKTSV4RRFFQ69G5FO1";
    const spaceId = "01ARZ3NDEKTSV4RRFFQ69G5FS1";
    const versionId = "01ARZ3NDEKTSV4RRFFQ69G5FV1";
    const actorUserId = "01ARZ3NDEKTSV4RRFFQ69G5FU1";
    const space: Space = {
      id: spaceId,
      code: "delivery",
      name: "Delivery",
      organizationId,
      settings: {
        staleThresholdDays: 3,
      },
      status: "ACTIVE",
    };
    const visibleWhere = {
      deletedAt: null,
      organizationId,
      OR: [
        {
          spaceId: {
            in: [spaceId],
          },
        },
      ],
      spaceId: {
        in: [spaceId],
      },
      type: {
        in: ["TASK", "BUG"],
      },
      versionId,
    };
    const workItemCount = vi
      .fn()
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0);
    const workItemGroupBy = vi
      .fn()
      .mockResolvedValueOnce([
        { _count: { _all: 2 }, statusCategory: "IN_PROGRESS" },
        { _count: { _all: 1 }, statusCategory: "WAITING" },
      ])
      .mockResolvedValueOnce([
        { _count: { _all: 2 }, statusCategory: "IN_PROGRESS" },
      ])
      .mockResolvedValueOnce([
        { _count: { _all: 1 }, statusCategory: "WAITING" },
      ])
      .mockResolvedValueOnce([
        { _count: { _all: 2 }, type: "TASK" },
        { _count: { _all: 1 }, type: "BUG" },
      ]);
    const prisma = {
      client: {
        requirement: {
          count: vi.fn(async () => 0),
        },
        version: {
          count: vi.fn(async () => 1),
        },
        workItem: {
          count: workItemCount,
          groupBy: workItemGroupBy,
        },
      },
    } as unknown as PrismaService;
    const repository = new PrismaSpaceRepository(prisma);
    const internals = repository as unknown as RepositoryInternals;
    internals.resolveViewAccessContext = vi.fn(async () => ({
      accessBySpaceId: new Map(),
      accesses: [],
      participantSpaceIds: [],
      participantWorkItemIds: [],
      readAllSpaceIds: [spaceId],
      spaceIds: [spaceId],
    }));
    internals.findCurrentVersion = vi.fn(async () => undefined);
    internals.findVersionById = vi.fn(async () => undefined);
    internals.listDefaultWorkflows = vi.fn(async () => []);
    internals.pageRecentActivities = vi.fn(async () => ({
      items: [],
      page: 1,
      pageSize: 20,
      total: 0,
    }));
    internals.getExceptionCounts = vi.fn(async () => []);

    const overview = await repository.getSpaceOverviewView({
      actorUserId,
      role: "PM",
      space,
      versionId,
    });

    expect(overview.statusCounts).toEqual([
      { count: 2, statusCategory: "IN_PROGRESS" },
      { count: 1, statusCategory: "WAITING" },
    ]);
    expect(overview.taskStatusCounts).toEqual([
      { count: 2, statusCategory: "IN_PROGRESS" },
    ]);
    expect(overview.bugStatusCounts).toEqual([
      { count: 1, statusCategory: "WAITING" },
    ]);
    expect(overview.workItemTypeCounts).toEqual([
      { count: 2, workItemType: "TASK" },
      { count: 1, workItemType: "BUG" },
    ]);
    expect(workItemGroupBy).toHaveBeenNthCalledWith(1, {
      _count: {
        _all: true,
      },
      by: ["statusCategory"],
      where: visibleWhere,
    });
    expect(workItemGroupBy).toHaveBeenNthCalledWith(2, {
      _count: {
        _all: true,
      },
      by: ["statusCategory"],
      where: {
        AND: [visibleWhere, { type: "TASK" }],
      },
    });
    expect(workItemGroupBy).toHaveBeenNthCalledWith(3, {
      _count: {
        _all: true,
      },
      by: ["statusCategory"],
      where: {
        AND: [visibleWhere, { type: "BUG" }],
      },
    });
    expect(workItemGroupBy).toHaveBeenNthCalledWith(4, {
      _count: {
        _all: true,
      },
      by: ["type"],
      where: visibleWhere,
    });
  });
});
