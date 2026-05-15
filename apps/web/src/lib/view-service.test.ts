import type {
  GetMyWorkbenchViewResponse,
  GetSpaceExceptionsViewResponse,
  GetSpaceOverviewViewResponse,
  GetVersionBoardViewResponse,
  ViewCurrentStatusSummary,
  ViewWorkItemSummary,
} from "@project-delivery/shared";
import { describe, expect, it, vi } from "vitest";

import {
  getMyWorkbenchView,
  getSpaceExceptionsView,
  getSpaceOverviewView,
  getVersionBoardView,
  type ViewApiTransport,
} from "./view-service";

const organizationId = "01ARZ3NDEKTSV4RRFFQ69G5F10";
const spaceId = "01ARZ3NDEKTSV4RRFFQ69G5F11";
const versionId = "01ARZ3NDEKTSV4RRFFQ69G5F12";
const workItemId = "01ARZ3NDEKTSV4RRFFQ69G5F13";
const reporterId = "01ARZ3NDEKTSV4RRFFQ69G5F14";
const assigneeId = "01ARZ3NDEKTSV4RRFFQ69G5F15";
const workflowVersionId = "01ARZ3NDEKTSV4RRFFQ69G5F16";
const stateId = "01ARZ3NDEKTSV4RRFFQ69G5F17";

function createApi(data: unknown): ViewApiTransport {
  return {
    get: vi.fn(async () => ({ data })) as unknown as ViewApiTransport["get"],
  };
}

describe("M4 view service", () => {
  it("loads my workbench through the shared response schema", async () => {
    const response = createWorkbenchResponse();
    const api = createApi(response);

    await expect(
      getMyWorkbenchView(
        {
          assigneeId,
          organizationId,
          spaceId,
          statusCategory: "WAITING",
          workItemType: "TASK",
        },
        api,
      ),
    ).resolves.toEqual(response);

    expect(api.get).toHaveBeenCalledWith("/views/my-workbench", {
      query: {
        assigneeId,
        organizationId,
        page: 1,
        pageSize: 20,
        spaceId,
        statusCategory: "WAITING",
        workItemType: "TASK",
      },
    });
  });

  it("loads space overview, version board, and space exceptions paths", async () => {
    const overview = createSpaceOverviewResponse();
    const board = createVersionBoardResponse();
    const exceptions = createSpaceExceptionsResponse();
    const overviewApi = createApi(overview);
    const boardApi = createApi(board);
    const exceptionsApi = createApi(exceptions);

    await expect(
      getSpaceOverviewView({ organizationId, spaceId, versionId }, overviewApi),
    ).resolves.toEqual(overview);
    await expect(
      getVersionBoardView(
        {
          assigneeId,
          organizationId,
          spaceId,
          statusCategory: "IN_PROGRESS",
          versionId,
        },
        boardApi,
      ),
    ).resolves.toEqual(board);
    await expect(
      getSpaceExceptionsView(
        {
          assigneeId,
          exceptionType: "blocked",
          organizationId,
          spaceId,
          statusCategory: "WAITING",
          versionId,
          workItemType: "BUG",
        },
        exceptionsApi,
      ),
    ).resolves.toEqual(exceptions);

    expect(overviewApi.get).toHaveBeenCalledWith(
      `/views/spaces/${spaceId}/overview`,
      {
        query: { organizationId, versionId },
      },
    );
    expect(boardApi.get).toHaveBeenCalledWith(
      `/views/versions/${versionId}/board`,
      {
        query: {
          assigneeId,
          organizationId,
          page: 1,
          pageSize: 20,
          spaceId,
          statusCategory: "IN_PROGRESS",
        },
      },
    );
    expect(exceptionsApi.get).toHaveBeenCalledWith(
      `/views/spaces/${spaceId}/exceptions`,
      {
        query: {
          assigneeId,
          exceptionType: "blocked",
          organizationId,
          page: 1,
          pageSize: 20,
          statusCategory: "WAITING",
          versionId,
          workItemType: "BUG",
        },
      },
    );
  });

  it("rejects invalid view responses", async () => {
    const api = createApi({ filters: {} });

    await expect(getMyWorkbenchView({ organizationId }, api)).rejects.toThrow();
  });
});

function createStatus(): ViewCurrentStatusSummary {
  return {
    currentStateId: stateId,
    exceptionHints: {
      blocked: true,
      pendingConfirm: false,
      pendingRegression: false,
    },
    lastStatusChangedAt: "2026-05-13T10:00:00.000Z",
    stateCode: "blocked",
    stateName: "Blocked",
    statusCategory: "WAITING",
    workflowVersionId,
  };
}

function createWorkItem(): ViewWorkItemSummary {
  return {
    assigneeId,
    currentStatus: createStatus(),
    dueDate: "2026-05-14T10:00:00.000Z",
    exceptionSignals: [
      {
        blockedReason: "Waiting for approval",
        evidenceSource: "BLOCKED_FIELD",
        reason: "Blocked by dependency",
        type: "blocked",
      },
    ],
    id: workItemId,
    organizationId,
    priority: "HIGH",
    reporterId,
    spaceId,
    title: "Prepare release",
    type: "TASK",
    versionId,
  };
}

function page<TItem>(items: TItem[]) {
  return {
    items,
    page: 1,
    pageSize: 20,
    total: items.length,
  };
}

function createWorkbenchResponse(): GetMyWorkbenchViewResponse {
  const section = {
    items: page([createWorkItem()]),
    title: "Section",
    total: 1,
  };
  const emptySection = {
    items: page<ViewWorkItemSummary>([]),
    title: "Empty",
    total: 0,
  };

  return {
    filters: {
      assigneeId,
      organizationId,
      spaceId,
      statusCategory: "WAITING",
      workItemType: "TASK",
    },
    sections: {
      actionTodos: {
        items: page([]),
        title: "Actions",
        total: 0,
      },
      assignedBugs: emptySection,
      assignedTasks: section,
      blocked: section,
      dueSoon: emptySection,
      myTodos: section,
      pendingConfirm: emptySection,
      recentActivities: {
        items: page([]),
        title: "Recent",
        total: 0,
      },
    },
    stats: {
      actionTodoCount: 0,
      assignedWorkItemCount: 1,
      blockedCount: 1,
      overdueCount: 0,
      pendingConfirmCount: 0,
      pendingRegressionCount: 0,
      staleCount: 0,
    },
  };
}

function createSpaceOverviewResponse(): GetSpaceOverviewViewResponse {
  return {
    defaultWorkflows: [],
    exceptionCounts: [{ count: 1, exceptionType: "blocked" }],
    filters: { organizationId, spaceId, versionId },
    recentActivities: page([]),
    space: {
      code: "CORE",
      id: spaceId,
      name: "Core",
      organizationId,
      settings: {
        staleThresholdDays: 3,
      },
      status: "ACTIVE",
    },
    staleThresholdDays: 3,
    stats: {
      blockedCount: 1,
      bugCount: 0,
      completedTaskCount: 0,
      openBugCount: 0,
      overdueCount: 0,
      requirementCount: 0,
      taskCount: 1,
      versionCount: 1,
    },
    statusCounts: [{ count: 1, statusCategory: "WAITING" }],
    workItemTypeCounts: [{ count: 1, workItemType: "TASK" }],
  };
}

function createVersionBoardResponse(): GetVersionBoardViewResponse {
  return {
    columns: [
      {
        statusCategory: "WAITING",
        title: "Waiting",
        total: 1,
      },
    ],
    filters: { organizationId, spaceId, versionId },
    items: page([createWorkItem()]),
  };
}

function createSpaceExceptionsResponse(): GetSpaceExceptionsViewResponse {
  return {
    counts: [{ count: 1, exceptionType: "blocked" }],
    filters: { exceptionType: "blocked", organizationId, spaceId, versionId },
    items: page([
      {
        currentStatus: createStatus(),
        exceptions: createWorkItem().exceptionSignals,
        workItem: createWorkItem(),
      },
    ]),
  };
}
