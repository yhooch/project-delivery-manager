import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useTranslations: (namespace?: string) => (key: string) =>
    namespace ? `${namespace}.${key}` : key,
}));

vi.mock("../ui/dropdown-menu", async () => {
  const React = await import("react");
  type AnyProps = Record<string, unknown> & {
    children?: React.ReactNode;
    onSelect?: (event: { preventDefault: () => void }) => void;
  };

  return {
    DropdownMenu: ({ children }: AnyProps) =>
      React.createElement("div", null, children),
    DropdownMenuContent: ({ children, ...rest }: AnyProps) =>
      React.createElement("div", { role: "menu", ...rest }, children),
    DropdownMenuItem: ({ children, onSelect, ...rest }: AnyProps) =>
      React.createElement(
        "button",
        {
          type: "button",
          onClick: () => onSelect?.({ preventDefault: () => {} }),
          ...rest,
        },
        children,
      ),
    DropdownMenuLabel: ({ children }: AnyProps) =>
      React.createElement("span", null, children),
    DropdownMenuSeparator: () => React.createElement("hr"),
    DropdownMenuTrigger: ({ children }: AnyProps) =>
      React.createElement(React.Fragment, null, children),
  };
});

const sessionMock = vi.hoisted(() => ({
  current: {
    currentOrganization: {
      code: "alpha",
      id: "ORG_ALPHA",
      name: "Alpha",
      role: "MEMBER",
      status: "ACTIVE",
    },
    currentSpace: undefined,
    session: {
      capabilities: {
        canCreateOrganization: true,
        canCreateSpace: true,
      },
      defaultOrganizationId: "ORG_ALPHA",
      organizations: [
        {
          code: "alpha",
          id: "ORG_ALPHA",
          name: "Alpha",
          role: "MEMBER",
          status: "ACTIVE",
        },
        {
          code: "beta",
          id: "ORG_BETA",
          name: "Beta",
          role: "ADMIN",
          status: "ACTIVE",
        },
      ],
      spaces: [],
      user: {
        id: "USR_01",
        name: "Demo",
        preferences: {
          locale: "zh-CN",
          themeMode: "SYSTEM",
        },
        status: "ACTIVE",
        username: "demo",
      },
    },
    spacesForCurrentOrganization: [],
    status: "authenticated" as const,
    switchOrganization: vi.fn(),
    switchSpace: vi.fn(),
  },
}));
vi.mock("../providers/session-provider", () => ({
  useSession: () => sessionMock.current,
}));

vi.mock("./create-organization-dialog", () => ({
  CreateOrganizationDialog: () => null,
}));

vi.mock("./create-space-dialog", () => ({
  CreateSpaceDialog: () => null,
}));

import { OrganizationSwitcher } from "./organization-switcher";

beforeEach(() => {
  sessionMock.current = {
    ...sessionMock.current,
    currentOrganization: {
      code: "alpha",
      id: "ORG_ALPHA",
      name: "Alpha",
      role: "MEMBER",
      status: "ACTIVE",
    },
    spacesForCurrentOrganization: [],
  };
});

afterEach(() => {
  cleanup();
});

describe("OrganizationSwitcher", () => {
  it("hides create-space for an active MEMBER current organization with capability", () => {
    render(<OrganizationSwitcher />);

    expect(
      screen.queryByTestId("org-switcher-create-space"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText("shell.organizationSwitcher.roles.MEMBER"),
    ).toBeInTheDocument();
    expect(screen.queryByText("MEMBER")).not.toBeInTheDocument();
  });

  it("shows create-space for an ADMIN current organization", () => {
    sessionMock.current = {
      ...sessionMock.current,
      currentOrganization: {
        code: "beta",
        id: "ORG_BETA",
        name: "Beta",
        role: "ADMIN",
        status: "ACTIVE",
      },
      session: {
        ...sessionMock.current.session,
        defaultOrganizationId: "ORG_BETA",
      },
    };

    render(<OrganizationSwitcher />);

    expect(screen.getByTestId("org-switcher-create-space")).toBeInTheDocument();
    expect(
      screen.getByText("shell.organizationSwitcher.roles.ADMIN"),
    ).toBeInTheDocument();
  });

  it("hides create-space for an ADMIN current organization when capability is false", () => {
    sessionMock.current = {
      ...sessionMock.current,
      currentOrganization: {
        code: "beta",
        id: "ORG_BETA",
        name: "Beta",
        role: "ADMIN",
        status: "ACTIVE",
      },
      session: {
        ...sessionMock.current.session,
        capabilities: {
          ...sessionMock.current.session.capabilities,
          canCreateSpace: false,
        },
        defaultOrganizationId: "ORG_BETA",
      },
    };

    render(<OrganizationSwitcher />);

    expect(
      screen.queryByTestId("org-switcher-create-space"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText("shell.organizationSwitcher.roles.ADMIN"),
    ).toBeInTheDocument();
  });

  it("hides create-space when the current organization is not active", () => {
    sessionMock.current = {
      ...sessionMock.current,
      currentOrganization: {
        ...sessionMock.current.currentOrganization,
        status: "DISABLED",
      },
    };

    render(<OrganizationSwitcher />);

    expect(
      screen.queryByTestId("org-switcher-create-space"),
    ).not.toBeInTheDocument();
  });
});
