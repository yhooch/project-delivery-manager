import type { PageResult, Requirement } from "@project-delivery/shared";
import { describe, expect, it, vi } from "vitest";

import {
  archiveRequirement,
  createRequirementDraft,
  deleteRequirementDraft,
  listRequirements,
  updateRequirement,
  type RequirementApiTransport,
} from "./requirement-service";

const organizationId = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
const spaceId = "01ARZ3NDEKTSV4RRFFQ69G5FAW";
const versionId = "01ARZ3NDEKTSV4RRFFQ69G5FAX";
const requirementId = "01ARZ3NDEKTSV4RRFFQ69G5FAY";
const ownerId = "01ARZ3NDEKTSV4RRFFQ69G5FAZ";

function createRequirementFixture(
  overrides: Partial<Requirement> = {},
): Requirement {
  return {
    contentFormat: "TIPTAP_JSON",
    contentJson: {
      content: [{ type: "paragraph" }],
      type: "doc",
    },
    createdAt: "2026-05-13T00:00:00.000Z",
    id: requirementId,
    organizationId,
    relatedWorkItems: {
      bugCount: 0,
      bugs: [],
      taskCount: 0,
      tasks: [],
    },
    spaceId,
    status: "DRAFT",
    title: "",
    updatedAt: "2026-05-13T00:00:00.000Z",
    versionId,
    ...overrides,
  };
}

function createPage(items: Requirement[]): PageResult<Requirement> {
  return {
    items,
    page: 1,
    pageSize: 100,
    total: items.length,
  };
}

function createApi(
  overrides: Partial<Record<keyof RequirementApiTransport, unknown>>,
): RequirementApiTransport {
  return {
    delete: vi.fn(),
    get: vi.fn(),
    patch: vi.fn(),
    post: vi.fn(),
    ...overrides,
  } as RequirementApiTransport;
}

describe("requirement service", () => {
  it("lists requirements with context-safe filters", async () => {
    const page = createPage([
      createRequirementFixture({
        ownerId,
        status: "CONFIRMED",
        title: "Checkout scope",
      }),
    ]);
    const api = createApi({
      get: vi.fn(async () => ({ data: page })),
    });

    await expect(
      listRequirements(
        {
          includeDrafts: true,
          organizationId,
          ownerId,
          page: 1,
          pageSize: 100,
          spaceId,
          status: "CONFIRMED",
          versionId,
        },
        api,
      ),
    ).resolves.toEqual(page);

    expect(api.get).toHaveBeenCalledWith(`/spaces/${spaceId}/requirements`, {
      query: {
        includeDrafts: true,
        ownerId,
        page: 1,
        pageSize: 100,
        status: "CONFIRMED",
        versionId,
      },
    });
  });

  it("creates drafts, saves content, archives, and deletes draft requirements", async () => {
    const draft = createRequirementFixture();
    const saved = createRequirementFixture({
      ownerId,
      status: "CONFIRMED",
      title: "Checkout scope",
    });
    const archived = createRequirementFixture({
      ...saved,
      status: "ARCHIVED",
    });
    const api = createApi({
      delete: vi.fn(async () => ({ data: {} })),
      patch: vi.fn(async (_path: string, body: unknown) => ({
        data: isArchiveBody(body) ? archived : saved,
      })),
      post: vi.fn(async () => ({ data: draft })),
    });

    await expect(
      createRequirementDraft(
        {
          organizationId,
          spaceId,
        },
        {
          versionId,
        },
        api,
      ),
    ).resolves.toEqual(draft);
    await expect(
      updateRequirement(
        {
          organizationId,
          requirementId,
          spaceId,
        },
        {
          contentJson: saved.contentJson,
          contentText: "Checkout scope",
          ownerId,
          title: "Checkout scope",
          versionId,
        },
        api,
      ),
    ).resolves.toEqual(saved);
    await expect(
      archiveRequirement(
        {
          organizationId,
          requirementId,
          spaceId,
        },
        api,
      ),
    ).resolves.toEqual(archived);
    await expect(
      deleteRequirementDraft(
        {
          organizationId,
          requirementId,
          spaceId,
        },
        api,
      ),
    ).resolves.toEqual({});

    expect(api.post).toHaveBeenCalledWith(`/spaces/${spaceId}/requirements`, {
      versionId,
    });
    expect(api.patch).toHaveBeenLastCalledWith(`/requirements/${requirementId}`, {
      status: "ARCHIVED",
    });
    expect(api.delete).toHaveBeenCalledWith(`/requirements/${requirementId}`);
  });
});

function isArchiveBody(body: unknown): body is { status: "ARCHIVED" } {
  return (
    typeof body === "object" &&
    body !== null &&
    "status" in body &&
    body.status === "ARCHIVED"
  );
}
