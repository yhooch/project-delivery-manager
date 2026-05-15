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
    participantRequirementIds: string[];
    participantSpaceIds: string[];
    participantWorkItemIds: string[];
    readAllSpaceIds: string[];
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
      participantIntakeItemIds: [],
      participantRequirementIds: [],
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
          },
        ],
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
      participantRequirementIds: [],
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

  it("includes non-work-item timeline events for read-all space roles", async () => {
    const organizationId = "01TRZ3NDEKTSV4RRFFQ69G5ORG";
    const spaceId = "01TRZ3NDEKTSV4RRFFQ69G5SPC";
    const actorUserId = "01TRZ3NDEKTSV4RRFFQ69G5USR";
    const events = [
      timelineEvent("01TRZ3NDEKTSV4RRFFQ69G5EV1", "WORK_ITEM", "01TRZ3NDEKTSV4RRFFQ69G5WI1"),
      timelineEvent("01TRZ3NDEKTSV4RRFFQ69G5EV2", "REQUIREMENT", "01TRZ3NDEKTSV4RRFFQ69G5RQ1"),
      timelineEvent("01TRZ3NDEKTSV4RRFFQ69G5EV3", "INTAKE_ITEM", "01TRZ3NDEKTSV4RRFFQ69G5IN1"),
      timelineEvent("01TRZ3NDEKTSV4RRFFQ69G5EV4", "VERSION", "01TRZ3NDEKTSV4RRFFQ69G5VR1"),
    ];
    const timelineFindMany = vi.fn(async () => events);
    const prisma = {
      client: {
        $transaction: vi.fn(async (operations: Promise<unknown>[]) =>
          Promise.all(operations),
        ),
        intakeItem: {
          findMany: vi.fn(async () => [
            { id: "01TRZ3NDEKTSV4RRFFQ69G5IN1", title: "Intake A" },
          ]),
        },
        requirement: {
          findMany: vi.fn(async () => [
            { id: "01TRZ3NDEKTSV4RRFFQ69G5RQ1", title: "Requirement A" },
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
            { id: "01TRZ3NDEKTSV4RRFFQ69G5WI1", title: "Task A" },
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
        participantRequirementIds: [],
        participantSpaceIds: [],
        participantWorkItemIds: [],
        readAllSpaceIds: [spaceId],
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
          OR: [
            {
              spaceId: {
                in: [spaceId],
              },
              targetType: {
                in: ["WORK_ITEM", "REQUIREMENT", "INTAKE_ITEM", "VERSION"],
              },
            },
          ],
        }),
      }),
    );
    expect(result.items.map((item) => item.target)).toEqual([
      { id: "01TRZ3NDEKTSV4RRFFQ69G5WI1", title: "Task A", type: "WORK_ITEM" },
      {
        id: "01TRZ3NDEKTSV4RRFFQ69G5RQ1",
        title: "Requirement A",
        type: "REQUIREMENT",
      },
      {
        id: "01TRZ3NDEKTSV4RRFFQ69G5IN1",
        title: "Intake A",
        type: "INTAKE_ITEM",
      },
      { id: "01TRZ3NDEKTSV4RRFFQ69G5VR1", title: "Version A", type: "VERSION" },
    ]);
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
        participantRequirementIds: [],
        participantSpaceIds: [],
        participantWorkItemIds: [],
        readAllSpaceIds: [spaceId],
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
