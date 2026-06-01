import type { TagDto } from "@project-delivery/shared";
import { describe, expect, it, vi } from "vitest";

import {
  createTag,
  deleteTag,
  getTagAssignments,
  listTagFilterOptions,
  listTags,
  mergeTags,
  replaceTagAssignments,
  type TagApiTransport,
} from "./tag-service";

const organizationId = "01VRZ3NDEKTSV4RRFFQ69G5F10";
const spaceId = "01VRZ3NDEKTSV4RRFFQ69G5F11";
const targetId = "01VRZ3NDEKTSV4RRFFQ69G5F12";
const tagId = "01VRZ3NDEKTSV4RRFFQ69G5FAV";
const secondTagId = "01VRZ3NDEKTSV4RRFFQ69G5FBV";

function createApi(data: unknown): TagApiTransport {
  return {
    delete: vi.fn(async () => ({
      data,
    })) as unknown as TagApiTransport["delete"],
    get: vi.fn(async () => ({ data })) as unknown as TagApiTransport["get"],
    patch: vi.fn(async () => ({
      data,
    })) as unknown as TagApiTransport["patch"],
    post: vi.fn(async () => ({ data })) as unknown as TagApiTransport["post"],
  };
}

function makeTag(overrides: Partial<TagDto> = {}): TagDto {
  return {
    id: tagId,
    organizationId,
    spaceId,
    name: "backend",
    displayName: "#backend",
    normalizedName: "backend",
    colorKey: "blue",
    createdAt: "2026-05-19T10:00:00.000Z",
    updatedAt: "2026-05-19T10:00:00.000Z",
    ...overrides,
  };
}

describe("tag service", () => {
  it("lists tags through the shared list query schema", async () => {
    const response = {
      items: [makeTag()],
      page: 1,
      pageSize: 20,
      total: 1,
    };
    const api = createApi(response);

    await expect(
      listTags({ organizationId, query: "back", spaceId }, api),
    ).resolves.toEqual(response);

    expect(api.get).toHaveBeenCalledWith(`/spaces/${spaceId}/tags`, {
      query: {
        includeUsage: false,
        page: 1,
        pageSize: 20,
        query: "back",
      },
    });
  });

  it("lists stable tag filter options for a page scope", async () => {
    const response = { items: [makeTag()] };
    const api = createApi(response);

    await expect(
      listTagFilterOptions(
        { organizationId, scope: "SPACE_EXCEPTION", spaceId },
        api,
      ),
    ).resolves.toEqual(response);

    expect(api.get).toHaveBeenCalledWith(
      `/spaces/${spaceId}/tag-filter-options`,
      {
        query: {
          scope: "SPACE_EXCEPTION",
        },
      },
    );
  });

  it("creates a tag and parses the response", async () => {
    const tag = makeTag({ name: "release", displayName: "#release" });
    const api = createApi(tag);

    await expect(
      createTag({ organizationId, spaceId }, { name: "release" }, api),
    ).resolves.toEqual(tag);

    expect(api.post).toHaveBeenCalledWith(`/spaces/${spaceId}/tags`, {
      name: "release",
    });
  });

  it("deletes an orphan tag through the shared delete response schema", async () => {
    const api = createApi({});

    await expect(deleteTag(tagId, api)).resolves.toBeUndefined();

    expect(api.delete).toHaveBeenCalledWith(`/tags/${tagId}`);
  });

  it("gets and replaces tag assignments", async () => {
    const response = {
      targetType: "WORK_ITEM",
      targetId,
      tags: [
        makeTag(),
        makeTag({
          id: secondTagId,
          name: "qa",
          displayName: "#qa",
          normalizedName: "qa",
        }),
      ],
    };
    const api = createApi(response);

    await expect(
      getTagAssignments({ targetId, targetType: "WORK_ITEM" }, api),
    ).resolves.toEqual(response);
    await expect(
      replaceTagAssignments(
        {
          targetId,
          targetType: "WORK_ITEM",
          tagIds: [tagId, secondTagId],
        },
        api,
      ),
    ).resolves.toEqual(response);

    expect(api.get).toHaveBeenCalledWith("/tag-assignments", {
      query: {
        targetId,
        targetType: "WORK_ITEM",
      },
    });
    expect(api.patch).toHaveBeenCalledWith("/tag-assignments", {
      targetId,
      targetType: "WORK_ITEM",
      tagIds: [tagId, secondTagId],
    });
  });

  it("merges source tags into a target tag through the space endpoint", async () => {
    const response = {
      targetTag: makeTag({
        id: secondTagId,
        name: "frontend",
        displayName: "#frontend",
        normalizedName: "frontend",
      }),
      sourceTags: [makeTag()],
      dryRun: true,
      sourceAssignmentsRemoved: 3,
      targetAssignmentsCreated: 2,
      duplicateAssignmentsSkipped: 1,
      deletedSourceTags: 0,
      affectedTargetsByType: [{ targetType: "WORK_ITEM", count: 3 }],
    };
    const api = createApi(response);

    await expect(
      mergeTags(
        {
          organizationId,
          sourceTagIds: [tagId],
          targetTagId: secondTagId,
          dryRun: true,
          spaceId,
        },
        api,
      ),
    ).resolves.toEqual(response);

    expect(api.post).toHaveBeenCalledWith(`/spaces/${spaceId}/tags/merge`, {
      sourceTagIds: [tagId],
      targetTagId: secondTagId,
      dryRun: true,
    });
  });
});
