import type { BugView, PageResult } from "@project-delivery/shared";
import { describe, expect, it, vi } from "vitest";

import {
  createBug,
  getBug,
  listBugs,
  updateBug,
  type BugApiTransport,
} from "./bug-service";

const organizationId = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
const spaceId = "01ARZ3NDEKTSV4RRFFQ69G5FAW";
const versionId = "01ARZ3NDEKTSV4RRFFQ69G5FAX";
const requirementId = "01ARZ3NDEKTSV4RRFFQ69G5FAY";
const bugId = "01ARZ3NDEKTSV4RRFFQ69G5FAZ";
const relatedTaskId = "01ARZ3NDEKTSV4RRFFQ69G5FB0";
const reporterId = "01ARZ3NDEKTSV4RRFFQ69G5FB1";
const assigneeId = "01ARZ3NDEKTSV4RRFFQ69G5FB2";
const createdById = "01ARZ3NDEKTSV4RRFFQ69G5FC1";
const workflowVersionId = "01ARZ3NDEKTSV4RRFFQ69G5FB3";
const stateId = "01ARZ3NDEKTSV4RRFFQ69G5FB4";
const tagId = "01ARZ3NDEKTSV4RRFFQ69G5FB5";
const permissions = {
  availableActions: [],
  canComment: true,
  canEdit: true,
  canUploadAttachment: true,
};

function createBugFixture(overrides: Partial<BugView> = {}): BugView {
  return {
    assigneeId,
    bugDetail: {
      actualResult: "Checkout fails with a 500 response",
      expectedResult: "Checkout succeeds",
      relatedTaskId,
      severity: "CRITICAL",
      stepsToReproduce: "Open checkout and submit the form",
      workItemId: bugId,
    },
    currentStateId: stateId,
    id: bugId,
    lastStatusChangedAt: "2026-05-13T10:00:00.000Z",
    organizationId,
    priority: "HIGH",
    reporterId,
    requirementId,
    spaceId,
    statusCategory: "NOT_STARTED",
    title: "Checkout submission fails",
    type: "BUG",
    versionId,
    workflowVersionId,
    ...overrides,
    tags: overrides.tags ?? [],
  };
}

function createPage(items: BugView[]): PageResult<BugView> {
  return {
    items,
    page: 1,
    pageSize: 20,
    total: items.length,
  };
}

function createApi(
  overrides: Partial<Record<keyof BugApiTransport, unknown>>,
): BugApiTransport {
  return {
    get: vi.fn(),
    patch: vi.fn(),
    post: vi.fn(),
    ...overrides,
  } as BugApiTransport;
}

describe("bug service", () => {
  it("lists bugs with shared query parsing and the space-scoped path", async () => {
    const page = createPage([createBugFixture()]);
    const api = createApi({
      get: vi.fn(async () => ({ data: page })),
    });

    await expect(
      listBugs(
        {
          organizationId,
          createdById,
          page: 1,
          pageSize: 20,
          relatedTaskId,
          severity: "CRITICAL",
          spaceId,
          statusCategory: "NOT_STARTED",
          versionId,
        },
        api,
      ),
    ).resolves.toEqual(page);

    expect(api.get).toHaveBeenCalledWith(`/spaces/${spaceId}/bugs`, {
      query: {
        createdById,
        page: 1,
        pageSize: 20,
        relatedTaskId,
        severity: "CRITICAL",
        statusCategory: "NOT_STARTED",
        type: "BUG",
        versionId,
      },
    });
  });

  it("keeps tagMatch only when tagIds are active", async () => {
    const page = createPage([createBugFixture()]);
    const api = createApi({
      get: vi.fn(async () => ({ data: page })),
    });

    await expect(
      listBugs(
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

    expect(api.get).toHaveBeenCalledWith(`/spaces/${spaceId}/bugs`, {
      query: {
        page: 1,
        pageSize: 20,
        tagIds: tagId,
        tagMatch: "ANY",
        type: "BUG",
      },
    });
  });

  it("creates, reads, and edits bugs through shared schemas", async () => {
    const created = createBugFixture();
    const detail = createBugFixture({ permissions });
    const updated = createBugFixture({
      bugDetail: {
        ...created.bugDetail,
        severity: "MAJOR",
      },
      priority: "URGENT",
    });
    const api = createApi({
      get: vi.fn(async () => ({ data: detail })),
      patch: vi.fn(async () => ({ data: updated })),
      post: vi.fn(async () => ({ data: created })),
    });

    await expect(
      createBug(
        {
          organizationId,
          spaceId,
        },
        {
          actualResult: "Checkout fails with a 500 response",
          assigneeId,
          expectedResult: "Checkout succeeds",
          priority: "HIGH",
          relatedTaskId,
          requirementId,
          severity: "CRITICAL",
          stepsToReproduce: "Open checkout and submit the form",
          title: "Checkout submission fails",
          versionId,
        },
        api,
      ),
    ).resolves.toEqual(created);
    await expect(getBug({ bugId, organizationId, spaceId }, api)).resolves.toEqual(
      detail,
    );
    await expect(
      updateBug(
        { bugId, organizationId, spaceId },
        {
          priority: "URGENT",
          severity: "MAJOR",
        },
        api,
      ),
    ).resolves.toEqual(updated);

    expect(api.post).toHaveBeenCalledWith(`/spaces/${spaceId}/bugs`, {
      actualResult: "Checkout fails with a 500 response",
      assigneeId,
      expectedResult: "Checkout succeeds",
      priority: "HIGH",
      relatedTaskId,
      requirementId,
      severity: "CRITICAL",
      stepsToReproduce: "Open checkout and submit the form",
      title: "Checkout submission fails",
      versionId,
    });
    expect(api.get).toHaveBeenCalledWith(`/bugs/${bugId}`);
    expect(api.patch).toHaveBeenCalledWith(`/bugs/${bugId}`, {
      priority: "URGENT",
      severity: "MAJOR",
    });
  });

  it("rejects a bug detail response without bug detail", async () => {
    const { bugDetail: _bugDetail, ...invalidBug } = createBugFixture();
    const api = createApi({
      get: vi.fn(async () => ({ data: invalidBug })),
    });

    await expect(getBug({ bugId, organizationId, spaceId }, api)).rejects.toThrow();
  });

  it("rejects a bug detail response without permissions", async () => {
    const api = createApi({
      get: vi.fn(async () => ({ data: createBugFixture() })),
    });

    await expect(getBug({ bugId, organizationId, spaceId }, api)).rejects.toThrow();
  });
});
