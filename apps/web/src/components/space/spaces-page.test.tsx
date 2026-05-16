import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { translatorCache } = vi.hoisted(() => ({
  translatorCache: new Map<
    string,
    (key: string, vars?: Record<string, unknown>) => string
  >(),
}));
vi.mock("next-intl", () => ({
  useTranslations: (namespace?: string) => {
    const key = namespace ?? "__root__";
    let fn = translatorCache.get(key);
    if (!fn) {
      fn = (k: string, vars?: Record<string, unknown>) => {
        const base = namespace ? `${namespace}.${k}` : k;
        if (!vars) return base;
        const suffix = Object.entries(vars)
          .map(([name, value]) => `${name}=${String(value)}`)
          .join(",");
        return `${base}(${suffix})`;
      };
      translatorCache.set(key, fn);
    }
    return fn;
  },
  useLocale: () => "en-US",
}));

const switchSpaceMock = vi.hoisted(() => vi.fn());
const sessionMock = vi.hoisted(() => ({
  current: {
    session: {
      defaultOrganizationId: "ORG_01",
      defaultSpaceId: "SPC_01",
      capabilities: {
        canCreateOrganization: true,
        canCreateSpace: true,
      },
    },
    currentOrganization: {
      id: "ORG_01",
      name: "Acme Corp",
      code: "ACME",
      role: "OWNER",
      status: "ACTIVE",
    },
    currentSpace: {
      id: "SPC_01",
      organizationId: "ORG_01",
      name: "Space A",
      code: "SPC-A",
      role: "SPACE_ADMIN",
      status: "ACTIVE",
    },
    spacesForCurrentOrganization: [
      {
        id: "SPC_01",
        organizationId: "ORG_01",
        name: "Space A",
        code: "SPC-A",
        role: "SPACE_ADMIN",
        status: "ACTIVE",
      },
      {
        id: "SPC_02",
        organizationId: "ORG_01",
        name: "Space B",
        code: "SPC-B",
        role: "PM",
        status: "ACTIVE",
      },
    ],
    status: "authenticated" as const,
    switchSpace: switchSpaceMock,
  },
}));
vi.mock("../providers/session-provider", () => ({
  useSession: () => sessionMock.current,
}));

const { listSpacesMock } = vi.hoisted(() => ({
  listSpacesMock: vi.fn(),
}));
vi.mock("../../lib/space-service", async () => {
  const actual = await vi.importActual<
    typeof import("../../lib/space-service")
  >("../../lib/space-service");
  return {
    ...actual,
    listSpaces: listSpacesMock,
  };
});

vi.mock("../shell/create-space-dialog", () => ({
  CreateSpaceDialog: ({ open }: { open: boolean }) =>
    open ? <div data-testid="create-space-dialog-open" /> : null,
}));

import { SpacesPage } from "./spaces-page";

function makeSpace(overrides: Record<string, unknown> = {}) {
  return {
    id: "SPC_01",
    organizationId: "ORG_01",
    name: "Space A",
    code: "SPC-A",
    description: "Delivery space",
    ownerId: "USR_PM",
    owner: {
      id: "USR_PM",
      name: "PM User",
      status: "ACTIVE",
      username: "pm",
    },
    currentVersion: {
      id: "VER_01",
      organizationId: "ORG_01",
      spaceId: "SPC_01",
      name: "2026 Q2",
      status: "IN_PROGRESS",
      stats: {
        requirementCount: 1,
        taskCount: 2,
        bugCount: 1,
        blockedCount: 1,
      },
    },
    unfinishedTaskCount: 5,
    openBugCount: 2,
    blockedCount: 1,
    status: "ACTIVE",
    updatedAt: "2026-05-14T08:30:00.000Z",
    ...overrides,
  } as unknown as import("@project-delivery/shared").SpaceSummary;
}

beforeEach(() => {
  listSpacesMock.mockReset();
  switchSpaceMock.mockReset();
  sessionMock.current = {
    session: {
      defaultOrganizationId: "ORG_01",
      defaultSpaceId: "SPC_01",
      capabilities: {
        canCreateOrganization: true,
        canCreateSpace: true,
      },
    },
    currentOrganization: {
      id: "ORG_01",
      name: "Acme Corp",
      code: "ACME",
      role: "OWNER",
      status: "ACTIVE",
    },
    currentSpace: {
      id: "SPC_01",
      organizationId: "ORG_01",
      name: "Space A",
      code: "SPC-A",
      role: "SPACE_ADMIN",
      status: "ACTIVE",
    },
    spacesForCurrentOrganization: [
      {
        id: "SPC_01",
        organizationId: "ORG_01",
        name: "Space A",
        code: "SPC-A",
        role: "SPACE_ADMIN",
        status: "ACTIVE",
      },
      {
        id: "SPC_02",
        organizationId: "ORG_01",
        name: "Space B",
        code: "SPC-B",
        role: "PM",
        status: "ACTIVE",
      },
    ],
    status: "authenticated" as const,
    switchSpace: switchSpaceMock,
  };
});

afterEach(() => {
  cleanup();
});

describe("SpacesPage", () => {
  it("lists organization spaces and switches to another joined space", async () => {
    listSpacesMock.mockResolvedValueOnce({
      items: [
        makeSpace(),
        makeSpace({ id: "SPC_02", name: "Space B", code: "SPC-B" }),
      ],
      total: 2,
    });
    switchSpaceMock.mockResolvedValueOnce(undefined);

    render(<SpacesPage />);

    await waitFor(() => expect(listSpacesMock).toHaveBeenCalledWith("ORG_01"));
    expect(await screen.findByText("Space A")).toBeInTheDocument();
    expect(screen.getByText("Space B")).toBeInTheDocument();
    expect(screen.getByTestId("spaces-create-button")).toBeInTheDocument();
    expect(screen.getByTestId("spaces-switch-SPC_01")).toBeDisabled();

    fireEvent.click(screen.getByTestId("spaces-switch-SPC_02"));

    await waitFor(() => expect(switchSpaceMock).toHaveBeenCalledWith("SPC_02"));
  });

  it("renders operational summary fields with fallbacks", async () => {
    listSpacesMock.mockResolvedValueOnce({
      items: [
        makeSpace(),
        makeSpace({
          id: "SPC_02",
          name: "Space C",
          code: "SPC-C",
          owner: undefined,
          ownerId: undefined,
          currentVersion: undefined,
          unfinishedTaskCount: undefined,
          openBugCount: undefined,
          blockedCount: undefined,
          updatedAt: undefined,
        }),
      ],
      total: 2,
    });

    render(<SpacesPage />);

    expect(await screen.findByText("Space A")).toBeInTheDocument();
    expect(screen.getByTestId("spaces-owner-SPC_01")).toHaveTextContent(
      "spaces.list.fields.ownerPM User",
    );
    expect(
      screen.getByTestId("spaces-current-version-SPC_01"),
    ).toHaveTextContent(
      "spaces.list.fields.currentVersion2026 Q2versionBoard.status.IN_PROGRESS",
    );
    expect(
      screen.getByTestId("spaces-unfinished-tasks-SPC_01"),
    ).toHaveTextContent("spaces.list.fields.unfinishedTaskCount5");
    expect(screen.getByTestId("spaces-open-bugs-SPC_01")).toHaveTextContent(
      "spaces.list.fields.openBugCount2",
    );
    expect(screen.getByTestId("spaces-blocked-SPC_01")).toHaveTextContent(
      "spaces.list.fields.blockedCount1",
    );
    expect(
      screen.getByTestId("spaces-updated-at-SPC_01").textContent,
    ).toContain("2026");
    expect(screen.getByTestId("spaces-updated-at-SPC_01")).toHaveTextContent(
      "spaces.list.fields.updatedAt: ",
    );

    expect(screen.getByTestId("spaces-owner-SPC_02")).toHaveTextContent(
      "spaces.list.fields.ownerspaces.list.emptyValue",
    );
    expect(
      screen.getByTestId("spaces-current-version-SPC_02"),
    ).toHaveTextContent(
      "spaces.list.fields.currentVersionspaces.list.emptyValue",
    );
    expect(
      screen.getByTestId("spaces-unfinished-tasks-SPC_02"),
    ).toHaveTextContent(
      "spaces.list.fields.unfinishedTaskCountspaces.list.emptyValue",
    );
    expect(screen.getByTestId("spaces-updated-at-SPC_02")).toHaveTextContent(
      "spaces.list.fields.updatedAt: spaces.list.emptyValue",
    );
  });

  it("renders read-only copy and no create action when capability is false", async () => {
    sessionMock.current = {
      ...sessionMock.current,
      session: {
        ...sessionMock.current.session,
        capabilities: {
          canCreateOrganization: true,
          canCreateSpace: false,
        },
      },
    };
    listSpacesMock.mockResolvedValueOnce({
      items: [makeSpace()],
      total: 1,
    });

    render(<SpacesPage />);

    expect(await screen.findByText("Space A")).toBeInTheDocument();
    expect(screen.getByTestId("spaces-readonly-notice")).toHaveTextContent(
      "spaces.list.readOnly",
    );
    expect(
      screen.queryByTestId("spaces-create-button"),
    ).not.toBeInTheDocument();
  });

  it("renders read-only copy for a non-admin role even when global capability allows it", async () => {
    sessionMock.current = {
      ...sessionMock.current,
      currentOrganization: {
        ...sessionMock.current.currentOrganization,
        role: "MEMBER",
      },
    };
    listSpacesMock.mockResolvedValueOnce({
      items: [makeSpace()],
      total: 1,
    });

    render(<SpacesPage />);

    expect(await screen.findByText("Space A")).toBeInTheDocument();
    expect(
      screen.queryByTestId("spaces-create-button"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("spaces-readonly-notice")).toHaveTextContent(
      "spaces.list.readOnly",
    );
  });

  it("does not render operational summary for spaces without membership", async () => {
    listSpacesMock.mockResolvedValueOnce({
      items: [
        makeSpace({
          id: "SPC_03",
          name: "Restricted Space",
          code: "SPC-R",
        }),
      ],
      total: 1,
    });

    render(<SpacesPage />);

    expect(await screen.findByText("Restricted Space")).toBeInTheDocument();
    expect(screen.getByTestId("spaces-restricted-SPC_03")).toHaveTextContent(
      "spaces.list.restricted",
    );
    expect(screen.queryByTestId("spaces-owner-SPC_03")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("spaces-current-version-SPC_03"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("spaces-unfinished-tasks-SPC_03"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("spaces-open-bugs-SPC_03"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("spaces-blocked-SPC_03"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("spaces-updated-at-SPC_03"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("spaces-switch-SPC_03")).toBeDisabled();
  });

  it("renders an empty state when the organization has no spaces", async () => {
    listSpacesMock.mockResolvedValueOnce({ items: [], total: 0 });

    render(<SpacesPage />);

    expect(await screen.findByText("spaces.list.empty")).toBeInTheDocument();
  });

  it("ignores a stale spaces response after switching organizations", async () => {
    let resolveOldOrganization: (value: unknown) => void = () => {};
    let resolveNewOrganization: (value: unknown) => void = () => {};
    listSpacesMock.mockImplementation((organizationId: string) => {
      return new Promise((resolve) => {
        if (organizationId === "ORG_01") {
          resolveOldOrganization = resolve;
        } else {
          resolveNewOrganization = resolve;
        }
      });
    });

    const { rerender } = render(<SpacesPage />);

    await waitFor(() => expect(listSpacesMock).toHaveBeenCalledWith("ORG_01"));

    sessionMock.current = {
      session: {
        defaultOrganizationId: "ORG_02",
        defaultSpaceId: "SPC_20",
        capabilities: {
          canCreateOrganization: true,
          canCreateSpace: true,
        },
      },
      currentOrganization: {
        id: "ORG_02",
        name: "Globex Corp",
        code: "GLOBEX",
        role: "OWNER",
        status: "ACTIVE",
      },
      currentSpace: {
        id: "SPC_20",
        organizationId: "ORG_02",
        name: "Fresh Space",
        code: "FRESH",
        role: "SPACE_ADMIN",
        status: "ACTIVE",
      },
      spacesForCurrentOrganization: [
        {
          id: "SPC_20",
          organizationId: "ORG_02",
          name: "Fresh Space",
          code: "FRESH",
          role: "SPACE_ADMIN",
          status: "ACTIVE",
        },
      ],
      status: "authenticated" as const,
      switchSpace: switchSpaceMock,
    };
    rerender(<SpacesPage />);

    await waitFor(() => expect(listSpacesMock).toHaveBeenCalledWith("ORG_02"));

    await act(async () => {
      resolveNewOrganization({
        items: [
          makeSpace({
            id: "SPC_20",
            organizationId: "ORG_02",
            name: "Fresh Space",
            code: "FRESH",
          }),
        ],
        total: 1,
      });
    });

    expect(await screen.findByText("Fresh Space")).toBeInTheDocument();

    await act(async () => {
      resolveOldOrganization({
        items: [
          makeSpace({
            id: "SPC_01",
            organizationId: "ORG_01",
            name: "Stale Space",
            code: "STALE",
          }),
        ],
        total: 1,
      });
    });

    await waitFor(() =>
      expect(screen.queryByText("Stale Space")).not.toBeInTheDocument(),
    );
    expect(screen.getByText("Fresh Space")).toBeInTheDocument();
  });
});
