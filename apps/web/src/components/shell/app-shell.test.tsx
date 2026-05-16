import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useTranslations: (namespace?: string) => (key: string) =>
    namespace ? `${namespace}.${key}` : key,
}));

vi.mock("../../i18n/routing", () => ({
  Link: ({
    children,
    href,
  }: {
    children: React.ReactNode;
    href: string;
  }) => <a href={href}>{children}</a>,
}));

const { sessionMock, useCommandPaletteShortcutMock } = vi.hoisted(() => ({
  sessionMock: {
    current: {
      currentOrganization: undefined as
        | { id: string; name: string; role: string; status: string }
        | undefined,
      session: null as
        | {
            organizations: Array<{
              id: string;
              name: string;
              role: string;
              status: string;
            }>;
          }
        | null,
      status: "unauthenticated" as
        | "loading"
        | "authenticated"
        | "unauthenticated",
    },
  },
  useCommandPaletteShortcutMock: vi.fn(),
}));
vi.mock("../providers/session-provider", () => ({
  useSession: () => sessionMock.current,
}));

vi.mock("./command-palette", () => ({
  CommandPalette: () => <div data-testid="command-palette" />,
  useCommandPaletteShortcut: useCommandPaletteShortcutMock,
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
  sessionMock.current = {
    currentOrganization: undefined,
    session: null,
    status: "unauthenticated",
  };
  useCommandPaletteShortcutMock.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("AppShell", () => {
  it("renders an actionable sign-in state instead of a blank page when unauthenticated", () => {
    render(<AppShell>Workspace</AppShell>);

    expect(
      screen.getByText("shell.unauthenticated.title"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "shell.unauthenticated.action" }),
    ).toHaveAttribute("href", "/login");
    expect(screen.queryByText("Workspace")).not.toBeInTheDocument();
  });

  it("renders only onboarding and global shell actions when authenticated without an organization", () => {
    sessionMock.current = {
      currentOrganization: undefined,
      session: {
        organizations: [],
      },
      status: "authenticated",
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
      status: "authenticated",
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
});
