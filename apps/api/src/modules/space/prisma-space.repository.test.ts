import type {
  GetSpaceOverviewViewResponse,
  PageResult,
  Space,
  VersionSummary,
} from "@project-delivery/shared";
import { describe, expect, it, vi } from "vitest";

import type { PrismaService } from "../../prisma/prisma.service";
import { PrismaSpaceRepository } from "./prisma-space.repository";

type RepositoryInternals = {
  findCurrentVersion(spaceId: string): Promise<VersionSummary | undefined>;
  findVersionById(
    spaceId: string,
    versionId: string,
  ): Promise<VersionSummary | undefined>;
  getExceptionCounts(...args: unknown[]): Promise<unknown[]>;
  getWorkbenchStats(...args: unknown[]): Promise<unknown>;
  listActionsByState(...args: unknown[]): Promise<Map<string, unknown[]>>;
  listDefaultWorkflows(spaceId: string): Promise<unknown[]>;
  pageActionTodos(...args: unknown[]): Promise<unknown>;
  pageRecentActivities(
    ...args: unknown[]
  ): Promise<GetSpaceOverviewViewResponse["recentActivities"] | unknown>;
  pageWorkItemSummaries(...args: unknown[]): Promise<unknown>;
  resolveViewAccessContext(...args: unknown[]): Promise<{
    accessBySpaceId: Map<string, unknown>;
    accesses: unknown[];
    participantIntakeItemIds: string[];
    participantSpaceIds: string[];
    participantWorkItemIds: string[];
    readAllSpaceIds: string[];
    intakeItemReadAllSpaceIds: string[];
    spaceIds: string[];
    testerSpaceIds: string[];
    testerWorkItemIds: string[];
  }>;
};

describe("PrismaSpaceRepository", () => {
  it("returns operational summary fields for organization space lists", async () => {
    const organizationId = "01ARZ3NDEKTSV4RRFFQ69G5FO1";
    const spaceId = "01ARZ3NDEKTSV4RRFFQ69G5FS1";
    const ownerId = "01ARZ3NDEKTSV4RRFFQ69G5FU1";
    const versionId = "01ARZ3NDEKTSV4RRFFQ69G5FV1";
    const spaceRecord = {
      id: spaceId,
      code: "delivery",
      description: null,
      name: "Delivery",
      organizationId,
      ownerId,
      owner: {
        id: ownerId,
        username: "owner_user",
        name: "Owner",
        avatar: null,
        status: "ACTIVE",
      },
      staleThresholdDays: 3,
      status: "ACTIVE",
      updatedAt: new Date("2026-05-14T10:00:00.000Z"),
    };
    const currentVersion = {
      id: versionId,
      bugCount: 1,
      blockedCount: 1,
      name: "M1",
      organizationId,
      ownerId: null,
      releaseDate: null,
      requirementCount: 2,
      spaceId,
      startDate: null,
      status: "IN_PROGRESS",
      target: null,
      targetDate: null,
      taskCount: 3,
      updatedAt: new Date("2026-05-14T09:00:00.000Z"),
    };
    const workItemGroupBy = vi
      .fn()
      .mockResolvedValueOnce([{ _count: { _all: 2 }, spaceId }])
      .mockResolvedValueOnce([{ _count: { _all: 1 }, spaceId }])
      .mockResolvedValueOnce([{ _count: { _all: 1 }, spaceId }]);
    const prisma = {
      client: {
        $transaction: vi.fn(async (queries: Array<Promise<unknown>>) =>
          Promise.all(queries),
        ),
        space: {
          findMany: vi.fn(async () => [spaceRecord]),
          count: vi.fn(async () => 1),
        },
        version: {
          findMany: vi.fn(async () => [currentVersion]),
        },
        workItem: {
          groupBy: workItemGroupBy,
        },
      },
    } as unknown as PrismaService;
    const repository = new PrismaSpaceRepository(prisma);

    const page = await repository.listByOrganizationId(organizationId, {
      page: 1,
      pageSize: 20,
    });

    expect(page.items[0]).toMatchObject({
      id: spaceId,
      owner: {
        id: ownerId,
        username: "owner_user",
      },
      currentVersion: {
        id: versionId,
        name: "M1",
      },
      unfinishedTaskCount: 2,
      openBugCount: 1,
      blockedCount: 1,
      updatedAt: "2026-05-14T10:00:00.000Z",
    });
    expect(workItemGroupBy).toHaveBeenCalledTimes(3);
  });

  it("filters organization space list aggregate counts by object visibility", async () => {
    const organizationId = "01LSZ3NDEKTSV4RRFFQ69G5FO1";
    const spaceId = "01LSZ3NDEKTSV4RRFFQ69G5FS1";
    const actorUserId = "01LSZ3NDEKTSV4RRFFQ69G5FU1";
    const visibleWorkItemId = "01LSZ3NDEKTSV4RRFFQ69G5FW1";
    const spaceRecord = {
      id: spaceId,
      code: "restricted",
      description: null,
      name: "Restricted",
      organizationId,
      ownerId: null,
      owner: null,
      staleThresholdDays: 3,
      status: "ACTIVE",
      updatedAt: new Date("2026-05-14T10:00:00.000Z"),
    };
    const workItemGroupBy = vi.fn(async () => []);
    const prisma = {
      client: {
        $transaction: vi.fn(async (queries: Array<Promise<unknown>>) =>
          Promise.all(queries),
        ),
        space: {
          findMany: vi.fn(async () => [spaceRecord]),
          count: vi.fn(async () => 1),
        },
        version: {
          findMany: vi.fn(async () => []),
        },
        workItem: {
          groupBy: workItemGroupBy,
        },
      },
    } as unknown as PrismaService;
    const repository = new PrismaSpaceRepository(prisma);
    const internals = repository as unknown as RepositoryInternals;
    const access = {
      organizationId,
      role: "DEVELOPER",
      spaceId,
      staleThresholdDays: 3,
    };

    internals.resolveViewAccessContext = vi.fn(async () => ({
      accessBySpaceId: new Map([[spaceId, access]]),
      accesses: [access],
      participantIntakeItemIds: [],
      participantSpaceIds: [spaceId],
      participantWorkItemIds: [visibleWorkItemId],
      readAllSpaceIds: [],
      intakeItemReadAllSpaceIds: [],
      spaceIds: [spaceId],
      testerSpaceIds: [],
      testerWorkItemIds: [],
    }));

    await repository.listByOrganizationId(
      organizationId,
      {
        aggregateActorUserId: actorUserId,
        page: 1,
        pageSize: 20,
      },
      actorUserId,
    );

    expect(internals.resolveViewAccessContext).toHaveBeenCalledWith({
      actorUserId,
      organizationId,
    });
    const groupByCalls = workItemGroupBy.mock.calls as unknown as Array<
      [{ where: unknown }]
    >;

    expect(JSON.stringify(groupByCalls[0]?.[0].where)).toContain(
      visibleWorkItemId,
    );
    expect(JSON.stringify(groupByCalls[1]?.[0].where)).toContain(
      visibleWorkItemId,
    );
    expect(JSON.stringify(groupByCalls[2]?.[0].where)).toContain(
      visibleWorkItemId,
    );
  });

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
    const requirementCount = vi.fn(async () => 0);
    const prisma = {
      client: {
        document: {
          count: requirementCount,
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
    const access = {
      organizationId,
      role: "PM",
      spaceId,
      staleThresholdDays: 3,
    };
    internals.resolveViewAccessContext = vi.fn(async () => ({
      accessBySpaceId: new Map([[spaceId, access]]),
      accesses: [access],
      participantIntakeItemIds: [],
      participantSpaceIds: [],
      participantWorkItemIds: [],
      readAllSpaceIds: [spaceId],
      intakeItemReadAllSpaceIds: [spaceId],
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
    expect(requirementCount).toHaveBeenCalledWith({
      where: {
        deletedAt: null,
        kind: "REQUIREMENT",
        organizationId,
        spaceId: {
          in: [spaceId],
        },
        versionId,
      },
    });
    expect(workItemCount).toHaveBeenNthCalledWith(5, {
      where: {
        AND: [
          {
            AND: [
              visibleWhere,
              {
                statusCategory: {
                  notIn: ["DONE", "TERMINATED"],
                },
              },
            ],
          },
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
            statusCategory: {
              notIn: ["DONE", "TERMINATED"],
            },
          },
        ],
      },
    });
  });

  it("scopes overview requirement count to participant requirements for restricted roles", async () => {
    const organizationId = "01BRZ3NDEKTSV4RRFFQ69G5FO1";
    const spaceId = "01BRZ3NDEKTSV4RRFFQ69G5FS1";
    const versionId = "01BRZ3NDEKTSV4RRFFQ69G5FV1";
    const actorUserId = "01BRZ3NDEKTSV4RRFFQ69G5FU1";
    const space: Space = {
      id: spaceId,
      code: "restricted",
      name: "Restricted",
      organizationId,
      settings: {
        staleThresholdDays: 3,
      },
      status: "ACTIVE",
    };
    const requirementCount = vi.fn(async () => 1);
    const prisma = {
      client: {
        document: {
          count: requirementCount,
        },
        version: {
          count: vi.fn(async () => 1),
        },
        workItem: {
          count: vi.fn(async () => 0),
          groupBy: vi.fn(async () => []),
        },
      },
    } as unknown as PrismaService;
    const repository = new PrismaSpaceRepository(prisma);
    const internals = repository as unknown as RepositoryInternals;
    const access = {
      organizationId,
      role: "DEVELOPER",
      spaceId,
      staleThresholdDays: 3,
    };
    internals.resolveViewAccessContext = vi.fn(async () => ({
      accessBySpaceId: new Map([[spaceId, access]]),
      accesses: [access],
      participantIntakeItemIds: [],
      participantSpaceIds: [spaceId],
      participantWorkItemIds: [],
      readAllSpaceIds: [],
      intakeItemReadAllSpaceIds: [],
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
      role: "DEVELOPER",
      space,
      versionId,
    });

    expect(overview.stats.requirementCount).toBe(1);
    expect(requirementCount).toHaveBeenCalledWith({
      where: {
        deletedAt: null,
        kind: "REQUIREMENT",
        organizationId,
        spaceId: {
          in: [spaceId],
        },
        versionId,
      },
    });
  });

  it("counts space requirements for REQUIREMENT role overview without work item read-all access", async () => {
    const organizationId = "01RRZ3NDEKTSV4RRFFQ69G5FO1";
    const spaceId = "01RRZ3NDEKTSV4RRFFQ69G5FS1";
    const versionId = "01RRZ3NDEKTSV4RRFFQ69G5FV1";
    const actorUserId = "01RRZ3NDEKTSV4RRFFQ69G5FU1";
    const space: Space = {
      id: spaceId,
      code: "requirement-role",
      name: "Requirement Role",
      organizationId,
      settings: {
        staleThresholdDays: 3,
      },
      status: "ACTIVE",
    };
    const visibleWorkItemWhere = {
      deletedAt: null,
      id: {
        in: [],
      },
      organizationId,
      spaceId: {
        in: [spaceId],
      },
      type: {
        in: ["TASK", "BUG"],
      },
      versionId,
    };
    const requirementCount = vi.fn(async () => 2);
    const workItemCount = vi.fn(async () => 0);
    const prisma = {
      client: {
        document: {
          count: requirementCount,
        },
        version: {
          count: vi.fn(async () => 1),
        },
        workItem: {
          count: workItemCount,
          groupBy: vi.fn(async () => []),
        },
      },
    } as unknown as PrismaService;
    const repository = new PrismaSpaceRepository(prisma);
    const internals = repository as unknown as RepositoryInternals;
    const access = {
      organizationId,
      role: "REQUIREMENT",
      spaceId,
      staleThresholdDays: 3,
    };

    internals.resolveViewAccessContext = vi.fn(async () => ({
      accessBySpaceId: new Map([[spaceId, access]]),
      accesses: [access],
      participantIntakeItemIds: [],
      participantSpaceIds: [spaceId],
      participantWorkItemIds: [],
      readAllSpaceIds: [],
      intakeItemReadAllSpaceIds: [],
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
      role: "REQUIREMENT",
      space,
      versionId,
    });

    expect(overview.stats.requirementCount).toBe(2);
    expect(requirementCount).toHaveBeenCalledWith({
      where: {
        deletedAt: null,
        kind: "REQUIREMENT",
        organizationId,
        spaceId: {
          in: [spaceId],
        },
        versionId,
      },
    });
    expect(workItemCount).toHaveBeenNthCalledWith(1, {
      where: {
        AND: [visibleWorkItemWhere, { type: "TASK" }],
      },
    });
  });

  it("scopes current version stats in overview for restricted roles", async () => {
    const organizationId = "01CRZ3NDEKTSV4RRFFQ69G5FO1";
    const spaceId = "01CRZ3NDEKTSV4RRFFQ69G5FS1";
    const versionId = "01CRZ3NDEKTSV4RRFFQ69G5FV1";
    const actorUserId = "01CRZ3NDEKTSV4RRFFQ69G5FU1";
    const space: Space = {
      id: spaceId,
      code: "current-version",
      name: "Current Version",
      organizationId,
      settings: {
        staleThresholdDays: 3,
      },
      status: "ACTIVE",
    };
    const currentVersion = {
      id: versionId,
      name: "M4",
      organizationId,
      spaceId,
      status: "IN_PROGRESS" as const,
      stats: {
        blockedCount: 99,
        bugCount: 99,
        requirementCount: 99,
        taskCount: 99,
      },
    };
    const requirementCount = vi.fn(async () => 1);
    const workItemCount = vi.fn(async () => 0);
    const prisma = {
      client: {
        document: {
          count: requirementCount,
        },
        version: {
          count: vi.fn(async () => 1),
        },
        workItem: {
          count: workItemCount,
          groupBy: vi.fn(async () => []),
        },
      },
    } as unknown as PrismaService;
    const repository = new PrismaSpaceRepository(prisma);
    const internals = repository as unknown as RepositoryInternals;
    const access = {
      organizationId,
      role: "DEVELOPER",
      spaceId,
      staleThresholdDays: 3,
    };
    internals.resolveViewAccessContext = vi.fn(async () => ({
      accessBySpaceId: new Map([[spaceId, access]]),
      accesses: [access],
      participantIntakeItemIds: [],
      participantSpaceIds: [spaceId],
      participantWorkItemIds: [],
      readAllSpaceIds: [],
      intakeItemReadAllSpaceIds: [],
      spaceIds: [spaceId],
      testerSpaceIds: [],
      testerWorkItemIds: [],
    }));
    internals.findCurrentVersion = vi.fn(async () => currentVersion);
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
      role: "DEVELOPER",
      space,
    });

    expect(overview.currentVersion?.stats).toEqual({
      blockedCount: 0,
      bugCount: 0,
      requirementCount: 1,
      taskCount: 0,
    });
    expect(requirementCount).toHaveBeenNthCalledWith(2, {
      where: {
        deletedAt: null,
        kind: "REQUIREMENT",
        organizationId,
        spaceId: {
          in: [spaceId],
        },
        versionId,
      },
    });
  });

  it("includes draft requirements in current version stats for space members", async () => {
    const organizationId = "01CRZ3NDEKTSV4RRFFQ69G5FO2";
    const spaceId = "01CRZ3NDEKTSV4RRFFQ69G5FS2";
    const versionId = "01CRZ3NDEKTSV4RRFFQ69G5FV2";
    const actorUserId = "01CRZ3NDEKTSV4RRFFQ69G5FU2";
    const space: Space = {
      id: spaceId,
      code: "current-version-read-all",
      name: "Current Version Read All",
      organizationId,
      settings: {
        staleThresholdDays: 3,
      },
      status: "ACTIVE",
    };
    const currentVersion = {
      id: versionId,
      name: "M5",
      organizationId,
      spaceId,
      status: "IN_PROGRESS" as const,
      stats: {
        blockedCount: 99,
        bugCount: 99,
        requirementCount: 99,
        taskCount: 99,
      },
    };
    const requirementCount = vi.fn(async () => 2);
    const prisma = {
      client: {
        document: {
          count: requirementCount,
        },
        version: {
          count: vi.fn(async () => 1),
        },
        workItem: {
          count: vi.fn(async () => 0),
          groupBy: vi.fn(async () => []),
        },
      },
    } as unknown as PrismaService;
    const repository = new PrismaSpaceRepository(prisma);
    const internals = repository as unknown as RepositoryInternals;
    const access = {
      organizationId,
      role: "PM",
      spaceId,
      staleThresholdDays: 3,
    };
    internals.resolveViewAccessContext = vi.fn(async () => ({
      accessBySpaceId: new Map([[spaceId, access]]),
      accesses: [access],
      participantIntakeItemIds: [],
      participantSpaceIds: [spaceId],
      participantWorkItemIds: [],
      readAllSpaceIds: [spaceId],
      intakeItemReadAllSpaceIds: [spaceId],
      spaceIds: [spaceId],
      testerSpaceIds: [],
      testerWorkItemIds: [],
    }));
    internals.findCurrentVersion = vi.fn(async () => currentVersion);
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
    });

    expect(overview.currentVersion?.stats.requirementCount).toBe(2);
    expect(requirementCount).toHaveBeenNthCalledWith(2, {
      where: {
        deletedAt: null,
        kind: "REQUIREMENT",
        organizationId,
        spaceId: {
          in: [spaceId],
        },
        versionId,
      },
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
      participantIntakeItemIds: [],
      participantSpaceIds: [],
      participantWorkItemIds: [],
      readAllSpaceIds: [spaceId],
      intakeItemReadAllSpaceIds: [spaceId],
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
      expect(where).toContain("pending_regression");
      expect(where).toContain("regressionAt");
      expect(where).toContain("notIn");
      expect(where).not.toContain("REGRESSION_PASSED");
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

  it("builds exception aggregate filters from stable helper-backed rules", async () => {
    const count = vi.fn(async () => 0);
    const findMany = vi.fn(async () => []);
    const prisma = {
      client: {
        workItem: {
          count,
          findMany,
        },
      },
    } as unknown as PrismaService;
    const repository = new PrismaSpaceRepository(prisma);
    const internals = repository as unknown as RepositoryInternals;
    const baseWhere = { spaceId: "SPC_01" };

    await internals.getExceptionCounts(
      baseWhere,
      {
        accesses: [{ spaceId: "SPC_01", staleThresholdDays: 3 }],
      },
      new Date("2026-05-13T12:00:00.000Z"),
      3,
    );

    const countCalls = count.mock.calls as unknown as Array<
      [{ where: unknown }]
    >;
    const blockedWhere = JSON.stringify(countCalls[1]?.[0].where);
    const pendingConfirmWhere = JSON.stringify(countCalls[2]?.[0].where);
    const pendingRegressionWhere = JSON.stringify(countCalls[3]?.[0].where);

    expect(blockedWhere).toContain("currentState");
    expect(blockedWhere).toContain("blocked");
    expect(blockedWhere).toContain("阻塞");
    expect(blockedWhere).toContain("notIn");
    expect(blockedWhere).not.toContain("blockedAt");
    expect(blockedWhere).not.toContain("blockedReason");
    expect(pendingConfirmWhere).toContain("confirm");
    expect(pendingRegressionWhere).toContain("regressionAt");
    expect(pendingRegressionWhere).toContain("currentState");
    expect(pendingRegressionWhere).toContain("pending_regression");
    expect(pendingRegressionWhere).not.toContain("VERIFYING");
  });

  it("maps workbench work item summaries with readable display code", async () => {
    const spaceId = "01TRZ3NDEKTSV4RRFFQ69G5SPC";
    const workItem = {
      assigneeId: null,
      blockedAt: null,
      blockedReason: null,
      bugDetail: null,
      createdAt: new Date("2026-05-13T12:00:00.000Z"),
      createdById: null,
      currentState: {
        category: "IN_PROGRESS",
        code: "in_progress",
        id: "01TRZ3NDEKTSV4RRFFQ69G5STA",
        name: "In progress",
      },
      currentStateId: "01TRZ3NDEKTSV4RRFFQ69G5STA",
      dueDate: null,
      id: "01TRZ3NDEKTSV4RRFFQ69G5WID",
      intakeItemId: null,
      lastActionAt: null,
      lastStatusChangedAt: new Date("2026-05-13T12:00:00.000Z"),
      organizationId: "01TRZ3NDEKTSV4RRFFQ69G5ORG",
      priority: "MEDIUM",
      reporterId: "01TRZ3NDEKTSV4RRFFQ69G5USR",
      requirementId: null,
      sequence: 42,
      spaceId,
      statusCategory: "IN_PROGRESS",
      title: "Readable task",
      type: "TASK",
      versionId: null,
      workflowVersionId: "01TRZ3NDEKTSV4RRFFQ69G5WFV",
    };
    const prisma = {
      client: {
        $transaction: vi.fn(async (operations: Promise<unknown>[]) =>
          Promise.all(operations),
        ),
        workItem: {
          count: vi.fn(async () => 1),
          findMany: vi.fn(async () => [workItem]),
        },
      },
    } as unknown as PrismaService;
    const repository = new PrismaSpaceRepository(prisma);
    const internals = repository as unknown as RepositoryInternals;

    const result = (await internals.pageWorkItemSummaries(
      { id: workItem.id },
      { page: 1, pageSize: 20 },
      {
        accessBySpaceId: new Map(),
        accesses: [{ spaceId, staleThresholdDays: 3 }],
        participantIntakeItemIds: [],
        participantSpaceIds: [],
        participantWorkItemIds: [],
        readAllSpaceIds: [spaceId],
        intakeItemReadAllSpaceIds: [],
        spaceIds: [spaceId],
        testerSpaceIds: [],
        testerWorkItemIds: [],
      },
      new Date("2026-05-13T12:00:00.000Z"),
    )) as PageResult<{ displayCode?: string; sequence?: number }>;

    expect(result.items[0]).toMatchObject({
      sequence: 42,
      displayCode: "TASK-42",
    });
  });

  it("includes non-work-item timeline events for read-all space roles", async () => {
    const organizationId = "01TRZ3NDEKTSV4RRFFQ69G5ORG";
    const spaceId = "01TRZ3NDEKTSV4RRFFQ69G5SPC";
    const actorUserId = "01TRZ3NDEKTSV4RRFFQ69G5USR";
    const events = [
      timelineEvent(
        "01TRZ3NDEKTSV4RRFFQ69G5EV1",
        "WORK_ITEM",
        "01TRZ3NDEKTSV4RRFFQ69G5WI1",
      ),
      timelineEvent(
        "01TRZ3NDEKTSV4RRFFQ69G5EV2",
        "DOCUMENT",
        "01TRZ3NDEKTSV4RRFFQ69G5RQ1",
      ),
      timelineEvent(
        "01TRZ3NDEKTSV4RRFFQ69G5EV3",
        "INTAKE_ITEM",
        "01TRZ3NDEKTSV4RRFFQ69G5IN1",
      ),
      timelineEvent(
        "01TRZ3NDEKTSV4RRFFQ69G5EV4",
        "VERSION",
        "01TRZ3NDEKTSV4RRFFQ69G5VR1",
      ),
    ];
    const timelineFindMany = vi.fn(async () => events);
    const prisma = {
      client: {
        $transaction: vi.fn(async (operations: Promise<unknown>[]) =>
          Promise.all(operations),
        ),
        intakeItem: {
          findMany: vi.fn(async () => [
            {
              id: "01TRZ3NDEKTSV4RRFFQ69G5IN1",
              sequence: 3,
              title: "Intake A",
            },
          ]),
        },
        document: {
          findMany: vi.fn(async () => [
            {
              id: "01TRZ3NDEKTSV4RRFFQ69G5RQ1",
              kind: "REQUIREMENT",
              sequence: 2,
              title: "Requirement A",
            },
          ]),
        },
        timelineEvent: {
          count: vi.fn(async () => events.length),
          findMany: timelineFindMany,
        },
        version: {
          findMany: vi.fn(async () => [
            { id: "01TRZ3NDEKTSV4RRFFQ69G5VR1", name: "Version A" },
          ]),
        },
        workItem: {
          findMany: vi.fn(async () => [
            {
              id: "01TRZ3NDEKTSV4RRFFQ69G5WI1",
              sequence: 1,
              title: "Task A",
              type: "TASK",
            },
          ]),
        },
      },
    } as unknown as PrismaService;
    const repository = new PrismaSpaceRepository(prisma);
    const internals = repository as unknown as RepositoryInternals;

    const result = (await internals.pageRecentActivities(
      {
        accessBySpaceId: new Map(),
        accesses: [],
        participantIntakeItemIds: [],
        participantSpaceIds: [],
        participantWorkItemIds: [],
        readAllSpaceIds: [spaceId],
        intakeItemReadAllSpaceIds: [spaceId],
        spaceIds: [spaceId],
        testerSpaceIds: [],
        testerWorkItemIds: [],
      },
      {
        actorUserId,
        organizationId,
        page: 1,
        pageSize: 20,
      },
      organizationId,
    )) as PageResult<{ target: { title?: string; type: string } }>;

    expect(timelineFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: [
            {
              OR: expect.arrayContaining([
                {
                  targetId: "01TRZ3NDEKTSV4RRFFQ69G5WI1",
                  targetType: "WORK_ITEM",
                },
                {
                  targetId: "01TRZ3NDEKTSV4RRFFQ69G5RQ1",
                  targetType: "DOCUMENT",
                },
                {
                  targetId: "01TRZ3NDEKTSV4RRFFQ69G5IN1",
                  targetType: "INTAKE_ITEM",
                },
                {
                  targetId: "01TRZ3NDEKTSV4RRFFQ69G5VR1",
                  targetType: "VERSION",
                },
              ]),
            },
          ],
          spaceId: {
            in: [spaceId],
          },
          targetType: {
            in: ["WORK_ITEM", "DOCUMENT", "INTAKE_ITEM", "VERSION"],
          },
        }),
      }),
    );
    expect(result.items.map((item) => item.target)).toEqual([
      {
        id: "01TRZ3NDEKTSV4RRFFQ69G5WI1",
        sequence: 1,
        displayCode: "TASK-1",
        title: "Task A",
        type: "WORK_ITEM",
      },
      {
        id: "01TRZ3NDEKTSV4RRFFQ69G5RQ1",
        sequence: 2,
        displayCode: "REQ-2",
        title: "Requirement A",
        type: "DOCUMENT",
      },
      {
        id: "01TRZ3NDEKTSV4RRFFQ69G5IN1",
        sequence: 3,
        displayCode: "INTAKE-3",
        title: "Intake A",
        type: "INTAKE_ITEM",
      },
      { id: "01TRZ3NDEKTSV4RRFFQ69G5VR1", title: "Version A", type: "VERSION" },
    ]);
  });

  it("uses space membership to expose requirement document activity", async () => {
    const organizationId = "01TRZ3NDEKTSV4RRFFQ69G5ORG";
    const spaceId = "01TRZ3NDEKTSV4RRFFQ69G5SPC";
    const requirementFindMany = vi.fn(async () => [
      { id: "01TRZ3NDEKTSV4RRFFQ69G5RQ1", title: "Confirmed Requirement" },
    ]);
    const timelineFindMany = vi.fn(async () => []);
    const prisma = {
      client: {
        $transaction: vi.fn(async (operations: Promise<unknown>[]) =>
          Promise.all(operations),
        ),
        intakeItem: {
          findMany: vi.fn(async () => []),
        },
        document: {
          findMany: requirementFindMany,
        },
        timelineEvent: {
          count: vi.fn(async () => 0),
          findMany: timelineFindMany,
        },
        version: {
          findMany: vi.fn(async () => []),
        },
        workItem: {
          findMany: vi.fn(async () => []),
        },
      },
    } as unknown as PrismaService;
    const repository = new PrismaSpaceRepository(prisma);
    const internals = repository as unknown as RepositoryInternals;

    await internals.pageRecentActivities(
      {
        accessBySpaceId: new Map(),
        accesses: [],
        participantIntakeItemIds: [],
        participantSpaceIds: [],
        participantWorkItemIds: [],
        readAllSpaceIds: [spaceId],
        intakeItemReadAllSpaceIds: [],
        spaceIds: [spaceId],
        testerSpaceIds: [],
        testerWorkItemIds: [],
      },
      {
        actorUserId: "01TRZ3NDEKTSV4RRFFQ69G5USR",
        organizationId,
        page: 1,
        pageSize: 20,
      },
      organizationId,
    );

    expect(requirementFindMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({
          kind: "REQUIREMENT",
          spaceId: {
            in: [spaceId],
          },
        }),
      }),
    );
    expect(timelineFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: [
            {
              OR: [
                {
                  targetId: "01TRZ3NDEKTSV4RRFFQ69G5RQ1",
                  targetType: "DOCUMENT",
                },
              ],
            },
          ],
        }),
      }),
    );
  });

  it("does not expose action todos to VIEWER even when they are creator or assignee", async () => {
    const actorUserId = "01HRZ3NDEKTSV4RRFFQ69G5FVIEW";
    const organizationId = "01HRZ3NDEKTSV4RRFFQ69G5FORG1";
    const spaceId = "01HRZ3NDEKTSV4RRFFQ69G5FSPC1";
    const workflowVersionId = "01HRZ3NDEKTSV4RRFFQ69G5FWFV1";
    const currentStateId = "01HRZ3NDEKTSV4RRFFQ69G5FSTA1";
    const candidates = [
      actionTodoWorkItem({
        assigneeId: actorUserId,
        id: "01HRZ3NDEKTSV4RRFFQ69G5FWI01",
        title: "Assigned to viewer",
      }),
      actionTodoWorkItem({
        createdById: actorUserId,
        id: "01HRZ3NDEKTSV4RRFFQ69G5FWI02",
        title: "Created by viewer",
      }),
    ];
    const action = {
      actorRelations: ["ASSIGNEE", "CREATOR"],
      allowedSpaceRoles: ["VIEWER"],
      code: "SUBMIT",
      formFields: [],
      fromStateId: currentStateId,
      id: "01HRZ3NDEKTSV4RRFFQ69G5FACT1",
      name: "Submit",
      requiresComment: false,
      sortOrder: 1,
      toStateId: "01HRZ3NDEKTSV4RRFFQ69G5FSTA2",
      workflowVersionId,
    };
    const findMany = vi.fn(async () => candidates);
    const prisma = {
      client: {
        workItem: {
          findMany,
        },
      },
    } as unknown as PrismaService;
    const repository = new PrismaSpaceRepository(prisma);
    const internals = repository as unknown as RepositoryInternals;

    internals.listActionsByState = vi.fn(
      async () =>
        new Map([[`${workflowVersionId}:${currentStateId}`, [action]]]),
    );

    const result = (await internals.pageActionTodos(
      { organizationId },
      {
        actorUserId,
        organizationId,
        page: 1,
        pageSize: 10,
      },
      {
        accessBySpaceId: new Map([
          [
            spaceId,
            {
              organizationId,
              role: "VIEWER",
              spaceId,
              staleThresholdDays: 5,
            },
          ],
        ]),
        accesses: [],
        participantIntakeItemIds: [],
        participantSpaceIds: [],
        participantWorkItemIds: [],
        readAllSpaceIds: [spaceId],
        intakeItemReadAllSpaceIds: [],
        spaceIds: [spaceId],
        testerSpaceIds: [],
        testerWorkItemIds: [],
      },
      new Date("2026-05-13T12:00:00.000Z"),
    )) as PageResult<unknown>;

    expect(result).toEqual({
      items: [],
      page: 1,
      pageSize: 10,
      total: 0,
    });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId },
      }),
    );
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

function actionTodoWorkItem(
  overrides: Partial<{
    assigneeId: string | null;
    createdById: string | null;
    id: string;
    title: string;
  }> = {},
) {
  return {
    assigneeId: null,
    blockedAt: null,
    blockedReason: null,
    bugDetail: null,
    createdById: "01HRZ3NDEKTSV4RRFFQ69G5FCRT1",
    currentState: {
      category: "IN_PROGRESS",
      code: "in_progress",
      id: "01HRZ3NDEKTSV4RRFFQ69G5FSTA1",
      name: "In progress",
    },
    currentStateId: "01HRZ3NDEKTSV4RRFFQ69G5FSTA1",
    dueDate: null,
    id: "01HRZ3NDEKTSV4RRFFQ69G5FWI01",
    intakeItemId: null,
    lastActionAt: null,
    lastStatusChangedAt: new Date("2026-05-13T12:00:00.000Z"),
    organizationId: "01HRZ3NDEKTSV4RRFFQ69G5FORG1",
    priority: "MEDIUM",
    reporterId: "01HRZ3NDEKTSV4RRFFQ69G5FRPT1",
    requirementId: null,
    spaceId: "01HRZ3NDEKTSV4RRFFQ69G5FSPC1",
    statusCategory: "IN_PROGRESS",
    title: "Action todo work item",
    type: "TASK",
    versionId: null,
    workflowVersionId: "01HRZ3NDEKTSV4RRFFQ69G5FWFV1",
    ...overrides,
  };
}

function timelineEvent(id: string, targetType: string, targetId: string) {
  return {
    actor: {
      avatar: null,
      id: "01TRZ3NDEKTSV4RRFFQ69G5USR",
      name: "Taylor",
      username: "taylor",
    },
    after: null,
    before: null,
    createdAt: new Date("2026-05-13T12:00:00.000Z"),
    detail: null,
    eventType: "UPDATED",
    id,
    metadata: null,
    organizationId: "01TRZ3NDEKTSV4RRFFQ69G5ORG",
    spaceId: "01TRZ3NDEKTSV4RRFFQ69G5SPC",
    targetId,
    targetType,
    title: "updated",
  };
}
