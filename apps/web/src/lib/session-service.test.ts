import type { AppSession, Organization } from "@project-delivery/shared";
import { describe, expect, it, vi } from "vitest";

import {
  createOrganizationAndRefreshSession,
  logoutAccount,
  switchOrganization,
  switchSpace,
  updateUserPreferences,
  type SessionApiTransport,
} from "./session-service";

const organizationId = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
const spaceId = "01ARZ3NDEKTSV4RRFFQ69G5FAT";

function createSession(overrides: Partial<AppSession> = {}): AppSession {
  return {
    capabilities: {
      canCreateOrganization: true,
      canCreateSpace: false,
    },
    defaultOrganizationId: organizationId,
    organizations: [
      {
        code: "acme",
        id: organizationId,
        name: "Acme",
        role: "OWNER",
        status: "ACTIVE",
      },
    ],
    spaces: [],
    user: {
      id: "01ARZ3NDEKTSV4RRFFQ69G5FAB",
      name: "demo",
      preferences: {
        locale: "zh-CN",
        themeMode: "SYSTEM",
      },
      status: "ACTIVE",
      username: "demo",
    },
    ...overrides,
  };
}

function createApi(
  overrides: Partial<Record<keyof SessionApiTransport, unknown>>,
): SessionApiTransport {
  return {
    get: vi.fn(),
    patch: vi.fn(),
    post: vi.fn(),
    ...overrides,
  } as SessionApiTransport;
}

describe("session service", () => {
  it("refreshes the session with the created organization id", async () => {
    const organization: Organization = {
      code: "acme",
      id: organizationId,
      name: "Acme",
      ownerId: "01ARZ3NDEKTSV4RRFFQ69G5FAB",
      status: "ACTIVE",
    };
    const session = createSession();
    const api = createApi({
      get: vi.fn(async () => ({ data: session })),
      post: vi.fn(async () => ({ data: organization })),
    });

    await expect(
      createOrganizationAndRefreshSession({ name: "Acme" }, api),
    ).resolves.toBe(session);

    expect(api.post).toHaveBeenCalledWith("/organizations", { name: "Acme" });
    expect(api.get).toHaveBeenCalledWith("/auth/session", {
      query: { recentOrganizationId: organizationId },
    });
  });

  it("passes recentOrganizationId when switching organizations", async () => {
    const session = createSession();
    const api = createApi({
      get: vi.fn(async () => ({ data: session })),
    });

    await expect(switchOrganization(organizationId, api)).resolves.toBe(session);

    expect(api.get).toHaveBeenCalledWith("/auth/session", {
      query: { recentOrganizationId: organizationId },
    });
  });

  it("passes recentOrganizationId and recentSpaceId when switching spaces", async () => {
    const session = createSession({
      defaultSpaceId: spaceId,
      spaces: [
        {
          code: "core",
          id: spaceId,
          name: "Core",
          organizationId,
          role: "SPACE_ADMIN",
          status: "ACTIVE",
        },
      ],
    });
    const api = createApi({
      get: vi.fn(async () => ({ data: session })),
    });

    await expect(switchSpace(organizationId, spaceId, api)).resolves.toBe(
      session,
    );

    expect(api.get).toHaveBeenCalledWith("/auth/session", {
      query: { recentOrganizationId: organizationId, recentSpaceId: spaceId },
    });
  });

  it("updates user preferences through the shared preferences endpoint", async () => {
    const preferences = {
      locale: "en-US",
      themeMode: "DARK",
    } as const;
    const api = createApi({
      patch: vi.fn(async () => ({ data: preferences })),
    });

    await expect(updateUserPreferences(preferences, api)).resolves.toEqual(
      preferences,
    );

    expect(api.patch).toHaveBeenCalledWith("/users/me/preferences", preferences);
  });

  it("calls logout endpoint", async () => {
    const api = createApi({
      post: vi.fn(async () => ({ data: {} })),
    });

    await expect(logoutAccount(api)).resolves.toBeUndefined();

    expect(api.post).toHaveBeenCalledWith("/auth/logout", {});
  });
});
