import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useTranslations:
    (namespace?: string) => (key: string, values?: Record<string, unknown>) => {
      const renderedValues = values
        ? Object.values(values)
            .filter((value) => value !== undefined && value !== null)
            .join(" ")
        : "";

      return `${namespace ? `${namespace}.` : ""}${key}${
        renderedValues ? ` ${renderedValues}` : ""
      }`;
    },
}));

const {
  pathnameMock,
  realtimeProviderProps,
  searchParamsMock,
  sessionMock,
  useCommandPaletteShortcutMock,
} = vi.hoisted(() => ({
  pathnameMock: { current: "/" },
  realtimeProviderProps: {
    current: [] as Array<{
      organizationId: string | null | undefined;
      spaceId: string | null | undefined;
    }>,
  },
  sessionMock: {
    current: {
      currentOrganization: undefined as
        | { id: string; name: string; role: string; status: string }
        | undefined,
      currentSpace: undefined as
        | { id: string; name: string; organizationId: string; status?: string }
        | undefined,
      initializeSession: vi.fn(),
      session: null as {
        capabilities?: { canCreateSpace?: boolean };
        organizations: Array<{
          id: string;
          name: string;
          role: string;
          status: string;
        }>;
      } | null,
      sessionErrorKey: null as string | null,
      spacesForCurrentOrganization: [] as Array<{
        id: string;
        name: string;
        organizationId: string;
      }>,
      status: "unauthenticated" as
        | "loading"
        | "authenticated"
        | "unauthenticated"
        | "error",
      switchSpace: vi.fn(),
    },
  },
  searchParamsMock: { current: new URLSearchParams() },
  useCommandPaletteShortcutMock: vi.fn(),
}));

vi.mock("../../i18n/routing", () => ({
  Link: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
  usePathname: () => pathnameMock.current,
}));
vi.mock("next/navigation", () => ({
  useSearchParams: () => searchParamsMock.current,
}));
vi.mock("../../lib/realtime", () => ({
  RealtimeProvider: ({
    children,
    organizationId,
    spaceId,
  }: {
    children: React.ReactNode;
    organizationId?: string | null;
    spaceId?: string | null;
  }) => {
    realtimeProviderProps.current.push({ organizationId, spaceId });
    return <div data-testid="realtime-provider">{children}</div>;
  },
}));
vi.mock("../providers/session-provider", () => ({
  useSession: () => sessionMock.current,
}));

vi.mock("./command-palette", () => ({
  CommandPalette: () => <div data-testid="command-palette" />,
  useCommandPaletteShortcut: useCommandPaletteShortcutMock,
}));
vi.mock("./create-space-dialog", () => ({
  CreateSpaceDialog: () => <div data-testid="create-space-dialog" />,
}));
vi.mock("./onboarding-empty", () => ({
  OnboardingEmpty: () => <div data-testid="onboarding-empty" />,
}));
vi.mock("./sidebar", () => ({
  Sidebar: () => <aside data-testid="sidebar" />,
}));
vi.mock("./top-bar", () => ({
  TopBar: ({
    commandPaletteEnabled,
    onOpenSidebar,
  }: {
    commandPaletteEnabled?: boolean;
    onOpenSidebar?: () => void;
  }) => (
    <header
      data-command-palette-enabled={String(commandPaletteEnabled)}
      data-has-open-sidebar={String(Boolean(onOpenSidebar))}
      data-testid="top-bar"
    />
  ),
}));

import { AppShell } from "./app-shell";

beforeEach(() => {
  pathnameMock.current = "/";
  searchParamsMock.current = new URLSearchParams();
  realtimeProviderProps.current = [];
  sessionMock.current = {
    currentOrganization: undefined,
    currentSpace: undefined,
    initializeSession: vi.fn(),
    session: null,
    sessionErrorKey: null,
    spacesForCurrentOrganization: [],
    status: "unauthenticated",
    switchSpace: vi.fn(),
  };
  useCommandPaletteShortcutMock.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("AppShell", () => {
  it("renders an actionable sign-in state instead of a blank page when unauthenticated", () => {
    render(<AppShell>Workspace</AppShell>);

    expect(screen.getByText("shell.unauthenticated.title")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "shell.unauthenticated.action" }),
    ).toHaveAttribute("href", "/login");
    expect(screen.queryByText("Workspace")).not.toBeInTheDocument();
  });

  it("renders a recoverable session error state with a retry action", () => {
    const initializeSession = vi.fn();
    sessionMock.current = {
      currentOrganization: undefined,
      currentSpace: undefined,
      initializeSession,
      session: null,
      sessionErrorKey: "errors.api.INTERNAL_SERVER_ERROR",
      spacesForCurrentOrganization: [],
      status: "error",
      switchSpace: vi.fn(),
    };

    render(<AppShell>Workspace</AppShell>);

    expect(screen.getByText("shell.sessionError.title")).toBeInTheDocument();
    expect(
      screen.getByText("errors.api.INTERNAL_SERVER_ERROR"),
    ).toBeInTheDocument();
    screen.getByRole("button", { name: "shell.sessionError.retry" }).click();
    expect(initializeSession).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Workspace")).not.toBeInTheDocument();
  });

  it("renders only onboarding and global shell actions when authenticated without an organization", () => {
    sessionMock.current = {
      currentOrganization: undefined,
      currentSpace: undefined,
      initializeSession: vi.fn(),
      session: {
        organizations: [],
      },
      sessionErrorKey: null,
      spacesForCurrentOrganization: [],
      status: "authenticated",
      switchSpace: vi.fn(),
    };

    render(<AppShell>Workspace</AppShell>);

    expect(screen.getByTestId("top-bar")).toHaveAttribute(
      "data-command-palette-enabled",
      "false",
    );
    expect(screen.getByTestId("top-bar")).toHaveAttribute(
      "data-has-open-sidebar",
      "false",
    );
    expect(screen.getByTestId("onboarding-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("sidebar")).not.toBeInTheDocument();
    expect(screen.queryByTestId("command-palette")).not.toBeInTheDocument();
    expect(screen.queryByText("Workspace")).not.toBeInTheDocument();
    expect(useCommandPaletteShortcutMock).toHaveBeenCalledWith({
      enabled: false,
    });
  });

  it("keeps sidebar, command palette, shortcuts, and routed content for organization users", () => {
    sessionMock.current = {
      currentOrganization: {
        id: "ORG_01",
        name: "Org A",
        role: "OWNER",
        status: "ACTIVE",
      },
      currentSpace: {
        id: "SPC_01",
        name: "Space A",
        organizationId: "ORG_01",
        status: "ACTIVE",
      },
      initializeSession: vi.fn(),
      session: {
        organizations: [
          {
            id: "ORG_01",
            name: "Org A",
            role: "OWNER",
            status: "ACTIVE",
          },
        ],
      },
      sessionErrorKey: null,
      spacesForCurrentOrganization: [
        { id: "SPC_01", name: "Space A", organizationId: "ORG_01" },
      ],
      status: "authenticated",
      switchSpace: vi.fn(),
    };

    render(<AppShell>Workspace</AppShell>);

    expect(screen.getByTestId("top-bar")).toHaveAttribute(
      "data-command-palette-enabled",
      "true",
    );
    expect(screen.getByTestId("top-bar")).toHaveAttribute(
      "data-has-open-sidebar",
      "true",
    );
    expect(screen.getByText("Workspace")).toBeInTheDocument();
    expect(screen.getAllByTestId("sidebar")).toHaveLength(1);
    expect(screen.getByTestId("command-palette")).toBeInTheDocument();
    expect(screen.queryByTestId("onboarding-empty")).not.toBeInTheDocument();
    expect(useCommandPaletteShortcutMock).toHaveBeenCalledWith({
      enabled: true,
    });
  });

  it("uses organization-wide realtime scope on the workbench route", () => {
    sessionMock.current = {
      currentOrganization: {
        id: "ORG_01",
        name: "Org A",
        role: "OWNER",
        status: "ACTIVE",
      },
      currentSpace: {
        id: "SPC_01",
        name: "Space A",
        organizationId: "ORG_01",
        status: "ACTIVE",
      },
      initializeSession: vi.fn(),
      session: {
        organizations: [
          {
            id: "ORG_01",
            name: "Org A",
            role: "OWNER",
            status: "ACTIVE",
          },
        ],
      },
      sessionErrorKey: null,
      spacesForCurrentOrganization: [
        { id: "SPC_01", name: "Space A", organizationId: "ORG_01" },
      ],
      status: "authenticated",
      switchSpace: vi.fn(),
    };

    render(<AppShell>Workspace</AppShell>);

    expect(realtimeProviderProps.current).toContainEqual({
      organizationId: "ORG_01",
      spaceId: undefined,
    });
  });

  it("keeps non-workbench routes scoped to the current space", () => {
    pathnameMock.current = "/work-items";
    sessionMock.current = {
      currentOrganization: {
        id: "ORG_01",
        name: "Org A",
        role: "OWNER",
        status: "ACTIVE",
      },
      currentSpace: {
        id: "SPC_01",
        name: "Space A",
        organizationId: "ORG_01",
        status: "ACTIVE",
      },
      initializeSession: vi.fn(),
      session: {
        organizations: [
          {
            id: "ORG_01",
            name: "Org A",
            role: "OWNER",
            status: "ACTIVE",
          },
        ],
      },
      sessionErrorKey: null,
      spacesForCurrentOrganization: [
        { id: "SPC_01", name: "Space A", organizationId: "ORG_01" },
      ],
      status: "authenticated",
      switchSpace: vi.fn(),
    };

    render(<AppShell>Workspace</AppShell>);

    expect(realtimeProviderProps.current).toContainEqual({
      organizationId: "ORG_01",
      spaceId: "SPC_01",
    });
  });

  it("switches to the requested space and explains the automatic context change", async () => {
    let resolveSwitch: () => void = () => {};
    const switchSpace = vi.fn().mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveSwitch = resolve;
        }),
    );
    pathnameMock.current = "/work-items";
    searchParamsMock.current = new URLSearchParams({ spaceId: "SPC_02" });
    sessionMock.current = {
      currentOrganization: {
        id: "ORG_01",
        name: "Org A",
        role: "OWNER",
        status: "ACTIVE",
      },
      currentSpace: {
        id: "SPC_01",
        name: "Space A",
        organizationId: "ORG_01",
        status: "ACTIVE",
      },
      initializeSession: vi.fn(),
      session: {
        organizations: [
          {
            id: "ORG_01",
            name: "Org A",
            role: "OWNER",
            status: "ACTIVE",
          },
        ],
      },
      sessionErrorKey: null,
      spacesForCurrentOrganization: [
        { id: "SPC_01", name: "Space A", organizationId: "ORG_01" },
        { id: "SPC_02", name: "Space B", organizationId: "ORG_01" },
      ],
      status: "authenticated",
      switchSpace,
    };

    const { rerender } = render(<AppShell>Workspace</AppShell>);

    await waitFor(() => expect(switchSpace).toHaveBeenCalledWith("SPC_02"));
    expect(screen.queryByText("Workspace")).not.toBeInTheDocument();

    sessionMock.current = {
      ...sessionMock.current,
      currentSpace: {
        id: "SPC_02",
        name: "Space B",
        organizationId: "ORG_01",
        status: "ACTIVE",
      },
    };
    rerender(<AppShell>Workspace</AppShell>);

    const notice = await screen.findByRole("status");
    expect(notice).toHaveTextContent("shell.requestedSpaceSwitchNotice.title");
    expect(notice).toHaveTextContent("Space B");
    expect(screen.getByText("Workspace")).toBeInTheDocument();

    await act(async () => {
      resolveSwitch();
    });
  });

  it("shows the no-spaces create action for an active OWNER organization with backend capability", () => {
    sessionMock.current = {
      currentOrganization: {
        id: "ORG_01",
        name: "Org A",
        role: "OWNER",
        status: "ACTIVE",
      },
      currentSpace: undefined,
      initializeSession: vi.fn(),
      session: {
        capabilities: { canCreateSpace: true },
        organizations: [
          {
            id: "ORG_01",
            name: "Org A",
            role: "OWNER",
            status: "ACTIVE",
          },
        ],
      },
      sessionErrorKey: null,
      spacesForCurrentOrganization: [],
      status: "authenticated",
      switchSpace: vi.fn(),
    };

    render(<AppShell>Workspace</AppShell>);

    expect(screen.getByTestId("app-shell-no-spaces-empty")).toBeInTheDocument();
    expect(screen.getByTestId("app-shell-create-space-button")).toBeEnabled();
    expect(screen.queryByTestId("onboarding-empty")).not.toBeInTheDocument();
    expect(screen.queryByText("Workspace")).not.toBeInTheDocument();
  });

  it("hides the no-spaces create action for a MEMBER organization even when backend capability is true", () => {
    sessionMock.current = {
      currentOrganization: {
        id: "ORG_01",
        name: "Org A",
        role: "MEMBER",
        status: "ACTIVE",
      },
      currentSpace: undefined,
      initializeSession: vi.fn(),
      session: {
        capabilities: { canCreateSpace: true },
        organizations: [
          {
            id: "ORG_01",
            name: "Org A",
            role: "MEMBER",
            status: "ACTIVE",
          },
        ],
      },
      sessionErrorKey: null,
      spacesForCurrentOrganization: [],
      status: "authenticated",
      switchSpace: vi.fn(),
    };

    render(<AppShell>Workspace</AppShell>);

    expect(screen.getByTestId("app-shell-no-spaces-empty")).toBeInTheDocument();
    expect(
      screen.queryByTestId("app-shell-create-space-button"),
    ).not.toBeInTheDocument();
  });

  it.each(["OWNER", "ADMIN"])(
    "hides the no-spaces create action when backend capability is false for %s",
    (role) => {
      sessionMock.current = {
        currentOrganization: {
          id: "ORG_01",
          name: "Org A",
          role,
          status: "ACTIVE",
        },
        currentSpace: undefined,
        initializeSession: vi.fn(),
        session: {
          capabilities: { canCreateSpace: false },
          organizations: [
            {
              id: "ORG_01",
              name: "Org A",
              role,
              status: "ACTIVE",
            },
          ],
        },
        sessionErrorKey: null,
        spacesForCurrentOrganization: [],
        status: "authenticated",
        switchSpace: vi.fn(),
      };

      render(<AppShell>Workspace</AppShell>);

      expect(
        screen.queryByTestId("app-shell-create-space-button"),
      ).not.toBeInTheDocument();
    },
  );
});
