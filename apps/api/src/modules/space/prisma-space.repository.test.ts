import type {
  GetSpaceOverviewViewResponse,
  PageResult,
  Space,
} from "@project-delivery/shared";
import { describe, expect, it, vi } from "vitest";

import type { PrismaService } from "../../prisma/prisma.service";
import { PrismaSpaceRepository } from "./prisma-space.repository";

type RepositoryInternals = {
  findCurrentVersion(spaceId: string): Promise<undefined>;
  findVersionById(spaceId: string, versionId: string): Promise<undefined>;
  getExceptionCounts(...args: unknown[]): Promise<unknown[]>;
  getWorkbenchStats(...args: unknown[]): Promise<unknown>;
  listDefaultWorkflows(spaceId: string): Promise<unknown[]>;
  pageActionTodos(...args: unknown[]): Promise<unknown>;
  pageRecentActivities(
    ...args: unknown[]
  ): Promise<GetSpaceOverviewViewResponse["recentActivities"] | unknown>;
  pageWorkItemSummaries(...args: unknown[]): Promise<unknown>;
  resolveViewAccessContext(...args: unknown[]): Promise<{
    accessBySpaceId: Map<string, unknown>;
    accesses: unknown[];
    participantSpaceIds: string[];
    participantWorkItemIds: string[];
    readAllSpaceIds: string[];
    spaceIds: string[];
    testerSpaceIds: string[];
    testerWorkItemIds: string[];
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
      testerSpaceIds: [],
      testerWorkItemIds: [],
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

  it("applies all my workbench query filters to sections, actions, stats, and activities", async () => {
    const organizationId = "01BRZ3NDEKTSV4RRFFQ69G5FAA";
    const spaceId = "01DRZ3NDEKTSV4RRFFQ69G5FAC";
    const versionId = "01ERZ3NDEKTSV4RRFFQ69G5FAD";
    const actorUserId = "01FRZ3NDEKTSV4RRFFQ69G5FAE";
    const assigneeId = "01GRZ3NDEKTSV4RRFFQ69G5FAF";
    const access = {
      organizationId,
      role: "PM",
      spaceId,
      staleThresholdDays: 5,
    };
    const emptyWorkItems = emptyPage(2, 10);
    const emptyActionTodos = emptyPage(2, 10);
    const emptyActivities = emptyPage(2, 10);
    const prisma = {
      client: {},
    } as unknown as PrismaService;
    const repository = new PrismaSpaceRepository(prisma);
    const internals = repository as unknown as RepositoryInternals;
    const pageWorkItemSummaries = vi.fn(
      async (..._args: unknown[]) => emptyWorkItems,
    );
    const pageActionTodos = vi.fn(
      async (..._args: unknown[]) => emptyActionTodos,
    );
    const pageRecentActivities = vi.fn(
      async (..._args: unknown[]) => emptyActivities,
    );
    const getWorkbenchStats = vi.fn(async (..._args: unknown[]) => ({
      actionTodoCount: 0,
      assignedWorkItemCount: 0,
      blockedCount: 0,
      overdueCount: 0,
      pendingConfirmCount: 0,
      pendingRegressionCount: 0,
      staleCount: 0,
    }));

    internals.resolveViewAccessContext = vi.fn(async () => ({
      accessBySpaceId: new Map([[spaceId, access]]),
      accesses: [access],
      participantSpaceIds: [],
      participantWorkItemIds: [],
      readAllSpaceIds: [spaceId],
      spaceIds: [spaceId],
      testerSpaceIds: [],
      testerWorkItemIds: [],
    }));
    internals.pageWorkItemSummaries = pageWorkItemSummaries;
    internals.pageActionTodos = pageActionTodos;
    internals.pageRecentActivities = pageRecentActivities;
    internals.getWorkbenchStats = getWorkbenchStats;

    const result = await repository.getMyWorkbenchView({
      actorUserId,
      assigneeId,
      exceptionType: "pending_regression",
      organizationId,
      page: 2,
      pageSize: 10,
      spaceId,
      statusCategory: "WAITING",
      versionId,
      workItemType: "BUG",
    });
    const serializedSectionWheres = pageWorkItemSummaries.mock.calls.map(
      ([where]) => JSON.stringify(where),
    );
    const actionWhere = JSON.stringify(pageActionTodos.mock.calls[0]?.[0]);
    const statsWhere = JSON.stringify(getWorkbenchStats.mock.calls[0]?.[0]);
    const activityScopeWhere = JSON.stringify(
      pageRecentActivities.mock.calls[0]?.[3],
    );

    for (const where of [
      ...serializedSectionWheres,
      actionWhere,
      statsWhere,
      activityScopeWhere,
    ]) {
      expect(where).toContain(assigneeId);
      expect(where).toContain(versionId);
      expect(where).toContain("WAITING");
      expect(where).toContain("BUG");
      expect(where).toContain("regression");
    }
    expect(result.filters).toMatchObject({
      organizationId,
      spaceId,
      versionId,
      assigneeId,
      statusCategory: "WAITING",
      workItemType: "BUG",
      exceptionType: "pending_regression",
    });
  });
});

function emptyPage<T>(page: number, pageSize: number): PageResult<T> {
  return {
    items: [],
    page,
    pageSize,
    total: 0,
  };
}
