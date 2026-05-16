import type { AppSession, Organization } from "@project-delivery/shared";
import { describe, expect, it, vi } from "vitest";

import {
  createOrganizationAndRefreshSession,
  getPersistedAppSession,
  loginAccount,
  logoutAccount,
  persistRecentSessionSelection,
  refreshAppSession,
  switchOrganization,
  switchSpace,
  type RecentSessionStorage,
  updateUserPreferences,
  type SessionApiTransport,
} from "./session-service";

const organizationId = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
const spaceId = "01ARZ3NDEKTSV4RRFFQ69G5FAT";
const otherOrganizationId = "01ARZ3NDEKTSV4RRFFQ69G5FAQ";
const otherSpaceId = "01ARZ3NDEKTSV4RRFFQ69G5FAZ";

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

function createRecentStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  const storage = {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    removeItem: vi.fn((key: string) => {
      values.delete(key);
    }),
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value);
    }),
  } satisfies RecentSessionStorage;

  return { storage, values };
}

describe("session service", () => {
  it("refreshes the full session after login instead of trusting the login body", async () => {
    const emptyLoginSession = createSession({
      defaultOrganizationId: undefined,
      organizations: [],
      spaces: [],
    });
    const fullSession = createSession();
    const { storage } = createRecentStorage({
      "pdm.recentOrganizationId": organizationId,
    });
    const api = createApi({
      get: vi.fn(async () => ({ data: fullSession })),
      post: vi.fn(async () => ({ data: emptyLoginSession })),
    });

    await expect(
      loginAccount({ username: "demo", password: "password-123" }, api, storage),
    ).resolves.toBe(fullSession);

    expect(api.post).toHaveBeenCalledWith("/auth/login", {
      username: "demo",
      password: "password-123",
    });
    expect(api.get).toHaveBeenCalledWith("/auth/session");
  });

  it("reads persisted recent selection for initial session refresh", async () => {
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
    const { storage } = createRecentStorage({
      "pdm.recentOrganizationId": organizationId,
      "pdm.recentSpaceId": spaceId,
    });
    const api = createApi({
      get: vi.fn(async () => ({ data: session })),
    });

    await expect(getPersistedAppSession(api, storage)).resolves.toBe(session);

    expect(api.get).toHaveBeenCalledWith("/auth/session");
    expect(storage.setItem).toHaveBeenCalledWith(
      "pdm.recentOrganizationId",
      organizationId,
    );
    expect(storage.setItem).toHaveBeenCalledWith("pdm.recentSpaceId", spaceId);
  });

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
    const { storage } = createRecentStorage();

    await expect(
      createOrganizationAndRefreshSession({ name: "Acme" }, api, storage),
    ).resolves.toBe(session);

    expect(api.post).toHaveBeenCalledWith("/organizations", { name: "Acme" });
    expect(api.get).toHaveBeenCalledWith("/auth/session");
    expect(storage.setItem).toHaveBeenCalledWith(
      "pdm.recentOrganizationId",
      organizationId,
    );
  });

  it("persists recentOrganizationId before switching organizations", async () => {
    const session = createSession();
    const api = createApi({
      get: vi.fn(async () => ({ data: session })),
    });
    const { storage } = createRecentStorage();

    await expect(
      switchOrganization(organizationId, api, storage),
    ).resolves.toBe(session);

    expect(api.get).toHaveBeenCalledWith("/auth/session");
    expect(storage.setItem).toHaveBeenCalledWith(
      "pdm.recentOrganizationId",
      organizationId,
    );
  });

  it("persists recentOrganizationId and recentSpaceId before switching spaces", async () => {
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
    const { storage } = createRecentStorage();

    await expect(
      switchSpace(organizationId, spaceId, api, storage),
    ).resolves.toBe(session);

    expect(api.get).toHaveBeenCalledWith("/auth/session");
    expect(storage.setItem).toHaveBeenCalledWith("pdm.recentSpaceId", spaceId);
  });

  it("persists only a default space that belongs to the default organization", async () => {
    const { storage, values } = createRecentStorage({
      "pdm.recentSpaceId": spaceId,
    });
    const session = createSession({
      defaultOrganizationId: organizationId,
      defaultSpaceId: otherSpaceId,
      spaces: [
        {
          code: "other",
          id: otherSpaceId,
          name: "Other",
          organizationId: otherOrganizationId,
          role: "SPACE_ADMIN",
          status: "ACTIVE",
        },
      ],
    });

    persistRecentSessionSelection(session, storage);

    expect(values.get("pdm.recentOrganizationId")).toBe(organizationId);
    expect(values.has("pdm.recentSpaceId")).toBe(false);
    expect(storage.removeItem).toHaveBeenCalledWith("pdm.recentSpaceId");
  });

  it("persists validated defaults returned by explicit refresh", async () => {
    const session = createSession();
    const { storage } = createRecentStorage();
    const api = createApi({
      get: vi.fn(async () => ({ data: session })),
    });

    await expect(
      refreshAppSession(organizationId, undefined, api, storage),
    ).resolves.toBe(session);

    expect(storage.setItem).toHaveBeenCalledWith(
      "pdm.recentOrganizationId",
      organizationId,
    );
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
