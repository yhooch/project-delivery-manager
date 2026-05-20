import type {
  PermissionSnapshot,
  WorkflowActionSummary,
  WorkItem,
  WorkItemDetail,
} from "@project-delivery/shared";
import { describe, expect, it, vi } from "vitest";

import {
  executeAction,
  type ActionApiTransport,
} from "./action-service";

const organizationId = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
const spaceId = "01ARZ3NDEKTSV4RRFFQ69G5FAW";
const workItemId = "01ARZ3NDEKTSV4RRFFQ69G5FB0";
const actionId = "01ARZ3NDEKTSV4RRFFQ69G5FB6";
const reporterId = "01ARZ3NDEKTSV4RRFFQ69G5FB1";
const assigneeId = "01ARZ3NDEKTSV4RRFFQ69G5FB2";
const workflowVersionId = "01ARZ3NDEKTSV4RRFFQ69G5FB3";
const fromStateId = "01ARZ3NDEKTSV4RRFFQ69G5FB4";
const toStateId = "01ARZ3NDEKTSV4RRFFQ69G5FB5";

const action: WorkflowActionSummary = {
  code: "START_PROGRESS",
  formFields: [],
  fromStateId,
  id: actionId,
  name: "Start progress",
  order: 0,
  requiresComment: false,
  toStateId,
};

const permissions: PermissionSnapshot = {
  availableActions: [action],
  canComment: true,
  canEdit: true,
  canUploadAttachment: true,
};

function createWorkItemFixture(overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    assigneeId,
    currentStateId: toStateId,
    id: workItemId,
    lastActionAt: "2026-05-13T10:05:00.000Z",
    lastStatusChangedAt: "2026-05-13T10:05:00.000Z",
    organizationId,
    priority: "HIGH",
    reporterId,
    spaceId,
    statusCategory: "IN_PROGRESS",
    title: "Implement checkout scope",
    type: "TASK",
    workflowVersionId,
    ...overrides,
    tags: overrides.tags ?? [],
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

function createApi(
  overrides: Partial<Record<keyof ActionApiTransport, unknown>>,
): ActionApiTransport {
  return {
    post: vi.fn(),
    ...overrides,
  } as ActionApiTransport;
}

describe("action service", () => {
  it("executes a workflow action with shared request and response parsing", async () => {
    const detail = createDetailFixture();
    const api = createApi({
      post: vi.fn(async () => ({ data: detail })),
    });

    await expect(
      executeAction(
        {
          actionId,
          organizationId,
          spaceId,
          workItemId,
        },
        {
          comment: "  start work  ",
          formValues: {
            effort: 3,
          },
        },
        api,
      ),
    ).resolves.toEqual(detail);

    expect(api.post).toHaveBeenCalledWith(
      `/work-items/${workItemId}/actions/${actionId}/execute`,
      {
        comment: "  start work  ",
        formValues: {
          effort: 3,
        },
      },
    );
  });

  it("rejects action responses without detail permissions", async () => {
    const api = createApi({
      post: vi.fn(async () => ({ data: createWorkItemFixture() })),
    });

    await expect(
      executeAction(
        {
          actionId,
          organizationId,
          spaceId,
          workItemId,
        },
        {
          formValues: {},
        },
        api,
      ),
    ).rejects.toThrow();
  });
});
