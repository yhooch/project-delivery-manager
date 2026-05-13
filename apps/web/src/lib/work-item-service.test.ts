import type {
  PageResult,
  PermissionSnapshot,
  WorkItem,
  WorkItemDetail,
} from "@project-delivery/shared";
import { describe, expect, it, vi } from "vitest";

import {
  createWorkItem,
  getWorkItem,
  listWorkItems,
  updateWorkItem,
  type WorkItemApiTransport,
} from "./work-item-service";

const organizationId = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
const spaceId = "01ARZ3NDEKTSV4RRFFQ69G5FAW";
const versionId = "01ARZ3NDEKTSV4RRFFQ69G5FAX";
const requirementId = "01ARZ3NDEKTSV4RRFFQ69G5FAY";
const intakeItemId = "01ARZ3NDEKTSV4RRFFQ69G5FAZ";
const workItemId = "01ARZ3NDEKTSV4RRFFQ69G5FB0";
const reporterId = "01ARZ3NDEKTSV4RRFFQ69G5FB1";
const assigneeId = "01ARZ3NDEKTSV4RRFFQ69G5FB2";
const workflowVersionId = "01ARZ3NDEKTSV4RRFFQ69G5FB3";
const stateId = "01ARZ3NDEKTSV4RRFFQ69G5FB4";

const permissions: PermissionSnapshot = {
  availableActions: [],
  canComment: true,
  canEdit: true,
  canUploadAttachment: true,
};

function createWorkItemFixture(overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    assigneeId,
    currentStateId: stateId,
    id: workItemId,
    intakeItemId,
    lastStatusChangedAt: "2026-05-13T10:00:00.000Z",
    organizationId,
    priority: "MEDIUM",
    reporterId,
    requirementId,
    spaceId,
    statusCategory: "NOT_STARTED",
    title: "Implement checkout scope",
    type: "TASK",
    versionId,
    workflowVersionId,
    ...overrides,
  };
}

function createDetailFixture(
  overrides: Partial<WorkItemDetail> = {},
): WorkItemDetail {
  return {
    ...createWorkItemFixture(),
    permissions,
    ...overrides,
  };
}

function createPage(items: WorkItem[]): PageResult<WorkItem> {
  return {
    items,
    page: 1,
    pageSize: 20,
    total: items.length,
  };
}

function createApi(
  overrides: Partial<Record<keyof WorkItemApiTransport, unknown>>,
): WorkItemApiTransport {
  return {
    get: vi.fn(),
    patch: vi.fn(),
    post: vi.fn(),
    ...overrides,
  } as WorkItemApiTransport;
}

describe("work item service", () => {
  it("lists TASK work items with the space-scoped path", async () => {
    const page = createPage([createWorkItemFixture()]);
    const api = createApi({
      get: vi.fn(async () => ({ data: page })),
    });

    await expect(
      listWorkItems(
        {
          assigneeId,
          organizationId,
          page: 1,
          pageSize: 20,
          spaceId,
          statusCategory: "NOT_STARTED",
        },
        api,
      ),
    ).resolves.toEqual(page);

    expect(api.get).toHaveBeenCalledWith(`/spaces/${spaceId}/work-items`, {
      query: {
        assigneeId,
        page: 1,
        pageSize: 20,
        statusCategory: "NOT_STARTED",
        type: "TASK",
      },
    });
  });

  it("creates task-only work items and parses detail permissions snapshots", async () => {
    const created = createWorkItemFixture();
    const detail = createDetailFixture();
    const updated = createWorkItemFixture({ priority: "HIGH" });
    const api = createApi({
      get: vi.fn(async () => ({ data: detail })),
      patch: vi.fn(async () => ({ data: updated })),
      post: vi.fn(async () => ({ data: created })),
    });

    await expect(
      createWorkItem(
        {
          organizationId,
          spaceId,
        },
        {
          assigneeId,
          intakeItemId,
          priority: "MEDIUM",
          requirementId,
          title: "Implement checkout scope",
          versionId,
        },
        api,
      ),
    ).resolves.toEqual(created);
    await expect(
      getWorkItem({ organizationId, spaceId, workItemId }, api),
    ).resolves.toEqual(detail);
    await expect(
      updateWorkItem(
        { organizationId, spaceId, workItemId },
        {
          priority: "HIGH",
        },
        api,
      ),
    ).resolves.toEqual(updated);

    expect(api.post).toHaveBeenCalledWith(`/spaces/${spaceId}/work-items`, {
      assigneeId,
      intakeItemId,
      priority: "MEDIUM",
      requirementId,
      title: "Implement checkout scope",
      type: "TASK",
      versionId,
    });
    expect(api.get).toHaveBeenCalledWith(`/work-items/${workItemId}`);
    expect(api.patch).toHaveBeenCalledWith(`/work-items/${workItemId}`, {
      priority: "HIGH",
    });
  });

  it("rejects a work item detail response without permissions", async () => {
    const api = createApi({
      get: vi.fn(async () => ({ data: createWorkItemFixture() })),
    });

    await expect(
      getWorkItem({ organizationId, spaceId, workItemId }, api),
    ).rejects.toThrow();
  });
});
