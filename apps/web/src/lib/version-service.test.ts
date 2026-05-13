import type { PageResult, Version } from "@project-delivery/shared";
import { describe, expect, it, vi } from "vitest";

import {
  createVersion,
  listVersions,
  updateVersion,
  type VersionApiTransport,
} from "./version-service";

const organizationId = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
const spaceId = "01ARZ3NDEKTSV4RRFFQ69G5FAW";
const versionId = "01ARZ3NDEKTSV4RRFFQ69G5FAX";
const ownerId = "01ARZ3NDEKTSV4RRFFQ69G5FAY";

function createVersionFixture(overrides: Partial<Version> = {}): Version {
  return {
    id: versionId,
    organizationId,
    spaceId,
    name: "M1",
    ownerId,
    status: "PLANNED",
    stats: {
      blockedCount: 0,
      bugCount: 0,
      requirementCount: 2,
      taskCount: 0,
    },
    target: "Milestone target",
    ...overrides,
  };
}

function createPage(items: Version[]): PageResult<Version> {
  return {
    items,
    page: 1,
    pageSize: 100,
    total: items.length,
  };
}

function createApi(
  overrides: Partial<Record<keyof VersionApiTransport, unknown>>,
): VersionApiTransport {
  return {
    get: vi.fn(),
    patch: vi.fn(),
    post: vi.fn(),
    ...overrides,
  } as VersionApiTransport;
}

describe("version service", () => {
  it("lists versions with space-scoped filters", async () => {
    const page = createPage([createVersionFixture()]);
    const api = createApi({
      get: vi.fn(async () => ({ data: page })),
    });

    await expect(
      listVersions(
        {
          organizationId,
          ownerId,
          page: 1,
          pageSize: 100,
          spaceId,
          status: "PLANNED",
        },
        api,
      ),
    ).resolves.toEqual(page);

    expect(api.get).toHaveBeenCalledWith(`/spaces/${spaceId}/versions`, {
      query: {
        ownerId,
        page: 1,
        pageSize: 100,
        status: "PLANNED",
      },
    });
  });

  it("creates and updates versions through shared response schemas", async () => {
    const created = createVersionFixture();
    const updated = createVersionFixture({
      name: "M1 updated",
      status: "IN_PROGRESS",
    });
    const api = createApi({
      patch: vi.fn(async () => ({ data: updated })),
      post: vi.fn(async () => ({ data: created })),
    });

    await expect(
      createVersion(
        {
          organizationId,
          spaceId,
        },
        {
          name: "M1",
          ownerId,
          status: "PLANNED",
        },
        api,
      ),
    ).resolves.toEqual(created);
    await expect(
      updateVersion(
        {
          organizationId,
          spaceId,
          versionId,
        },
        {
          name: "M1 updated",
          status: "IN_PROGRESS",
        },
        api,
      ),
    ).resolves.toEqual(updated);

    expect(api.post).toHaveBeenCalledWith(`/spaces/${spaceId}/versions`, {
      name: "M1",
      ownerId,
      status: "PLANNED",
    });
    expect(api.patch).toHaveBeenCalledWith(`/versions/${versionId}`, {
      name: "M1 updated",
      status: "IN_PROGRESS",
    });
  });
});
