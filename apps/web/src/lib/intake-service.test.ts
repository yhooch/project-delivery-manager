import type {
  ConvertIntakeItemToWorkItemsResponse,
  IntakeItem,
  PageResult,
  WorkItem,
} from "@project-delivery/shared";
import { describe, expect, it, vi } from "vitest";

import {
  acceptIntakeItem,
  convertIntakeItemToWorkItems,
  createIntakeItem,
  deferIntakeItem,
  getIntakeItem,
  listIntakeItems,
  rejectIntakeItem,
  updateIntakeItem,
  type IntakeApiTransport,
} from "./intake-service";

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
const tagId = "01ARZ3NDEKTSV4RRFFQ69G5FB5";

function createIntakeFixture(overrides: Partial<IntakeItem> = {}): IntakeItem {
  return {
    assigneeId,
    description: "Follow up checkout scope",
    id: intakeItemId,
    organizationId,
    priority: "HIGH",
    reporterId,
    requirementId,
    sourceObject: {
      meetingId: "m-1",
    },
    sourceType: "MEETING_DECISION",
    spaceId,
    status: "PENDING",
    title: "Checkout scope follow-up",
    versionId,
    ...overrides,
    tags: overrides.tags ?? [],
  };
}

function createTaskFixture(overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    assigneeId,
    currentStateId: stateId,
    id: workItemId,
    lastStatusChangedAt: "2026-05-13T10:00:00.000Z",
    organizationId,
    priority: "HIGH",
    reporterId,
    requirementId,
    spaceId,
    statusCategory: "NOT_STARTED",
    title: "Implement checkout scope",
    type: "TASK",
    versionId,
    workflowVersionId,
    ...overrides,
    tags: overrides.tags ?? [],
  };
}

function createPage(items: IntakeItem[]): PageResult<IntakeItem> {
  return {
    items,
    page: 1,
    pageSize: 20,
    total: items.length,
  };
}

function createApi(
  overrides: Partial<Record<keyof IntakeApiTransport, unknown>>,
): IntakeApiTransport {
  return {
    get: vi.fn(),
    patch: vi.fn(),
    post: vi.fn(),
    ...overrides,
  } as IntakeApiTransport;
}

describe("intake service", () => {
  it("lists intake items with shared query parsing and space-scoped path", async () => {
    const page = createPage([createIntakeFixture()]);
    const api = createApi({
      get: vi.fn(async () => ({ data: page })),
    });

    await expect(
      listIntakeItems(
        {
          organizationId,
          page: 1,
          pageSize: 20,
          spaceId,
          status: "PENDING",
          versionId,
        },
        api,
      ),
    ).resolves.toEqual(page);

    expect(api.get).toHaveBeenCalledWith(`/spaces/${spaceId}/intake-items`, {
      query: {
        page: 1,
        pageSize: 20,
        status: "PENDING",
        versionId,
      },
    });
  });

  it("keeps tagMatch only when tagIds are active", async () => {
    const page = createPage([createIntakeFixture()]);
    const api = createApi({
      get: vi.fn(async () => ({ data: page })),
    });

    await expect(
      listIntakeItems(
        {
          organizationId,
          page: 1,
          pageSize: 20,
          spaceId,
          tagIds: tagId,
        },
        api,
      ),
    ).resolves.toEqual(page);

    expect(api.get).toHaveBeenCalledWith(`/spaces/${spaceId}/intake-items`, {
      query: {
        page: 1,
        pageSize: 20,
        tagIds: tagId,
        tagMatch: "ANY",
      },
    });
  });

  it("creates, reads, and edits intake items through shared schemas", async () => {
    const created = createIntakeFixture();
    const updated = createIntakeFixture({
      priority: "URGENT",
      title: "Updated follow-up",
    });
    const api = createApi({
      get: vi.fn(async () => ({ data: created })),
      patch: vi.fn(async () => ({ data: updated })),
      post: vi.fn(async () => ({ data: created })),
    });

    await expect(
      createIntakeItem(
        {
          organizationId,
          spaceId,
        },
        {
          assigneeId,
          priority: "HIGH",
          requirementId,
          sourceObject: { meetingId: "m-1" },
          sourceType: "MEETING_DECISION",
          title: "Checkout scope follow-up",
          versionId,
        },
        api,
      ),
    ).resolves.toEqual(created);
    await expect(
      getIntakeItem({ intakeItemId, organizationId, spaceId }, api),
    ).resolves.toEqual(created);
    await expect(
      updateIntakeItem(
        { intakeItemId, organizationId, spaceId },
        {
          priority: "URGENT",
          title: "Updated follow-up",
        },
        api,
      ),
    ).resolves.toEqual(updated);

    expect(api.post).toHaveBeenCalledWith(`/spaces/${spaceId}/intake-items`, {
      assigneeId,
      priority: "HIGH",
      requirementId,
      sourceObject: { meetingId: "m-1" },
      sourceType: "MEETING_DECISION",
      title: "Checkout scope follow-up",
      versionId,
    });
    expect(api.get).toHaveBeenCalledWith(`/intake-items/${intakeItemId}`);
    expect(api.patch).toHaveBeenCalledWith(`/intake-items/${intakeItemId}`, {
      priority: "URGENT",
      title: "Updated follow-up",
    });
  });

  it("posts accept, defer, reject, and convert actions", async () => {
    const accepted = createIntakeFixture({
      acceptedAt: "2026-05-13T10:10:00.000Z",
      status: "ACCEPTED",
    });
    const deferred = createIntakeFixture({ status: "DEFERRED" });
    const rejected = createIntakeFixture({ status: "REJECTED" });
    const converted: ConvertIntakeItemToWorkItemsResponse = {
      intakeItemId,
      workItems: [createTaskFixture()],
    };
    const api = createApi({
      post: vi.fn(async (path: string) => {
        if (path.endsWith("/accept")) {
          return { data: accepted };
        }
        if (path.endsWith("/defer")) {
          return { data: deferred };
        }
        if (path.endsWith("/reject")) {
          return { data: rejected };
        }

        return { data: converted };
      }),
    });

    await expect(
      acceptIntakeItem({ intakeItemId, organizationId, spaceId }, api),
    ).resolves.toEqual(accepted);
    await expect(
      deferIntakeItem({ intakeItemId, organizationId, spaceId }, api),
    ).resolves.toEqual(deferred);
    await expect(
      rejectIntakeItem({ intakeItemId, organizationId, spaceId }, api),
    ).resolves.toEqual(rejected);
    await expect(
      convertIntakeItemToWorkItems(
        { intakeItemId, organizationId, spaceId },
        {
          tasks: [
            {
              assigneeId,
              priority: "HIGH",
              title: "Implement checkout scope",
              versionId,
            },
          ],
        },
        api,
      ),
    ).resolves.toEqual(converted);

    expect(api.post).toHaveBeenNthCalledWith(
      1,
      `/intake-items/${intakeItemId}/accept`,
      {},
    );
    expect(api.post).toHaveBeenNthCalledWith(
      2,
      `/intake-items/${intakeItemId}/defer`,
      {},
    );
    expect(api.post).toHaveBeenNthCalledWith(
      3,
      `/intake-items/${intakeItemId}/reject`,
      {},
    );
    expect(api.post).toHaveBeenNthCalledWith(
      4,
      `/intake-items/${intakeItemId}/convert-to-work-items`,
      {
        tasks: [
          {
            assigneeId,
            priority: "HIGH",
            title: "Implement checkout scope",
            versionId,
          },
        ],
      },
    );
  });
});
