import type {
  OrganizationMemberWithUser,
  PageResult,
  Space,
  SpaceMemberWithUser,
} from "@project-delivery/shared";
import { describe, expect, it, vi } from "vitest";

import {
  addSpaceMember,
  createSpace,
  disableOrganizationMember,
  listOrganizationMembers,
  listSpaceMembers,
  listSpaces,
  updateSpaceMember,
  type WorkspaceApiTransport,
} from "./space-service";

const organizationId = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
const spaceId = "01ARZ3NDEKTSV4RRFFQ69G5FAT";
const userId = "01ARZ3NDEKTSV4RRFFQ69G5FAB";
const memberId = "01ARZ3NDEKTSV4RRFFQ69G5FAM";

function createApi(
  overrides: Partial<Record<keyof WorkspaceApiTransport, unknown>>,
): WorkspaceApiTransport {
  return {
    delete: vi.fn(),
    get: vi.fn(),
    patch: vi.fn(),
    post: vi.fn(),
    ...overrides,
  } as WorkspaceApiTransport;
}

describe("space service", () => {
  it("loads organization members with an organization-scoped request", async () => {
    const result: PageResult<OrganizationMemberWithUser> = {
      items: [],
      page: 1,
      pageSize: 200,
      total: 0,
    };
    const api = createApi({
      get: vi.fn(async () => ({ data: result })),
    });

    await expect(listOrganizationMembers(organizationId, api)).resolves.toBe(
      result,
    );

    expect(api.get).toHaveBeenCalledWith(
      `/organizations/${organizationId}/members`,
      {
        query: { page: 1, pageSize: 200 },
      },
    );
  });

  it("creates and lists spaces under the current organization", async () => {
    const space: Space = {
      code: "core",
      id: spaceId,
      name: "Core",
      organizationId,
      settings: {
        staleThresholdDays: 3,
      },
      status: "ACTIVE",
    };
    const api = createApi({
      get: vi.fn(async () => ({
        data: {
          items: [space],
          page: 1,
          pageSize: 200,
          total: 1,
        },
      })),
      post: vi.fn(async () => ({ data: space })),
    });

    await expect(
      createSpace(
        organizationId,
        {
          name: "Core",
          staleThresholdDays: 3,
        },
        api,
      ),
    ).resolves.toBe(space);
    await expect(listSpaces(organizationId, api)).resolves.toEqual({
      items: [space],
      page: 1,
      pageSize: 200,
      total: 1,
    });

    expect(api.post).toHaveBeenCalledWith(
      `/organizations/${organizationId}/spaces`,
      {
        name: "Core",
        staleThresholdDays: 3,
      },
    );
    expect(api.get).toHaveBeenCalledWith(
      `/organizations/${organizationId}/spaces`,
      {
        query: { page: 1, pageSize: 200 },
      },
    );
  });

  it("lists active space members with a status filter", async () => {
    const result: PageResult<SpaceMemberWithUser> = {
      items: [],
      page: 1,
      pageSize: 200,
      total: 0,
    };
    const api = createApi({
      get: vi.fn(async () => ({ data: result })),
    });

    await expect(
      listSpaceMembers(spaceId, { status: "ACTIVE" }, api),
    ).resolves.toBe(result);

    expect(api.get).toHaveBeenCalledWith(`/spaces/${spaceId}/members`, {
      query: { page: 1, pageSize: 200, status: "ACTIVE" },
    });
  });

  it("disables an organization member with a PATCH status update", async () => {
    const member = {
      id: memberId,
      organizationId,
      role: "MEMBER",
      status: "DISABLED",
      user: {
        id: userId,
        name: "Demo User",
        status: "ACTIVE",
        username: "demo",
      },
      userId,
    } as OrganizationMemberWithUser;
    const api = createApi({
      patch: vi.fn(async () => ({ data: member })),
    });

    await expect(
      disableOrganizationMember(organizationId, memberId, api),
    ).resolves.toBe(member);

    expect(api.patch).toHaveBeenCalledWith(
      `/organizations/${organizationId}/members/${memberId}`,
      {
        status: "DISABLED",
      },
    );
  });

  it("uses space-scoped member endpoints for add and update", async () => {
    const member: SpaceMemberWithUser = {
      id: memberId,
      organizationId,
      role: "MEMBER",
      spaceId,
      status: "ACTIVE",
      user: {
        id: userId,
        name: "Demo User",
        status: "ACTIVE",
        username: "demo",
      },
      userId,
    };
    const api = createApi({
      patch: vi.fn(async () => ({ data: member })),
      post: vi.fn(async () => ({ data: member })),
    });

    await expect(
      addSpaceMember(spaceId, { role: "MEMBER", userId }, api),
    ).resolves.toBe(member);
    await expect(
      updateSpaceMember(spaceId, memberId, { status: "DISABLED" }, api),
    ).resolves.toBe(member);

    expect(api.post).toHaveBeenCalledWith(`/spaces/${spaceId}/members`, {
      role: "MEMBER",
      userId,
    });
    expect(api.patch).toHaveBeenCalledWith(
      `/spaces/${spaceId}/members/${memberId}`,
      {
        status: "DISABLED",
      },
    );
  });
});
