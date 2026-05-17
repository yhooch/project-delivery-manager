import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
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
    currentSpace: undefined as
      | {
          code: string;
          id: string;
          name: string;
          organizationId: string;
          role: string;
          status: string;
        }
      | undefined,
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
    spacesForCurrentOrganization: [] as Array<{
      code: string;
      id: string;
      name: string;
      organizationId: string;
      role: string;
      status: string;
    }>,
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

import { ApiClientError } from "../../lib/api-client";
import { OrganizationSwitcher } from "./organization-switcher";

beforeEach(() => {
  const switchOrganization = sessionMock.current.switchOrganization;
  const switchSpace = sessionMock.current.switchSpace;
  switchOrganization.mockReset();
  switchSpace.mockReset();
  sessionMock.current = {
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
    switchOrganization,
    switchSpace,
  };
});

afterEach(() => {
  cleanup();
});

describe("OrganizationSwitcher", () => {
  it("hides create-space for a MEMBER organization even when backend capability is true", () => {
    render(<OrganizationSwitcher />);

    expect(
      screen.queryByTestId("org-switcher-create-space"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText("shell.organizationSwitcher.roles.MEMBER"),
    ).toBeInTheDocument();
    expect(screen.queryByText("MEMBER")).not.toBeInTheDocument();
  });

  it.each(["OWNER", "ADMIN"])(
    "shows create-space for an active %s current organization with backend capability",
    (role) => {
      sessionMock.current = {
        ...sessionMock.current,
        currentOrganization: {
          code: "beta",
          id: "ORG_BETA",
          name: "Beta",
          role,
          status: "ACTIVE",
        },
        session: {
          ...sessionMock.current.session,
          defaultOrganizationId: "ORG_BETA",
          organizations: sessionMock.current.session.organizations.map(
            (organization) =>
              organization.id === "ORG_BETA"
                ? { ...organization, role }
                : organization,
          ),
        },
      };

      render(<OrganizationSwitcher />);

      expect(
        screen.getByTestId("org-switcher-create-space"),
      ).toBeInTheDocument();
    },
  );

  it.each(["OWNER", "ADMIN"])(
    "hides create-space when backend capability is false for %s",
    (role) => {
      sessionMock.current = {
        ...sessionMock.current,
        currentOrganization: {
          code: "beta",
          id: "ORG_BETA",
          name: "Beta",
          role,
          status: "ACTIVE",
        },
        session: {
          ...sessionMock.current.session,
          capabilities: {
            ...sessionMock.current.session.capabilities,
            canCreateSpace: false,
          },
          defaultOrganizationId: "ORG_BETA",
          organizations: sessionMock.current.session.organizations.map(
            (organization) =>
              organization.id === "ORG_BETA"
                ? { ...organization, role }
                : organization,
          ),
        },
      };

      render(<OrganizationSwitcher />);

      expect(
        screen.queryByTestId("org-switcher-create-space"),
      ).not.toBeInTheDocument();
      expect(
        screen.getByText(`shell.organizationSwitcher.roles.${role}`),
      ).toBeInTheDocument();
    },
  );

  it("keeps create-organization controlled by global capability", () => {
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
          canCreateOrganization: true,
          canCreateSpace: false,
        },
        defaultOrganizationId: "ORG_BETA",
      },
    };

    render(<OrganizationSwitcher />);

    expect(screen.getByTestId("org-switcher-create-org")).toBeInTheDocument();
  });

  it("hides create-organization when global capability is false", () => {
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
          canCreateOrganization: false,
          canCreateSpace: false,
        },
        defaultOrganizationId: "ORG_BETA",
      },
    };

    render(<OrganizationSwitcher />);

    expect(
      screen.queryByTestId("org-switcher-create-org"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText("shell.organizationSwitcher.roles.ADMIN"),
    ).toBeInTheDocument();
  });

  it("hides create-space when the backend capability is false", () => {
    sessionMock.current = {
      ...sessionMock.current,
      session: {
        ...sessionMock.current.session,
        capabilities: {
          ...sessionMock.current.session.capabilities,
          canCreateSpace: false,
        },
      },
    };

    render(<OrganizationSwitcher />);

    expect(
      screen.queryByTestId("org-switcher-create-space"),
    ).not.toBeInTheDocument();
  });

  it("shows an API error and restores pending state when switching organization fails", async () => {
    sessionMock.current.switchOrganization.mockRejectedValueOnce(
      new ApiClientError(
        {
          code: "FORBIDDEN",
          message: "Forbidden",
          requestId: "req_org_switch",
        },
        new Response(null, { status: 403 }),
      ),
    );

    render(<OrganizationSwitcher />);

    fireEvent.click(screen.getByTestId("org-switcher-org-ORG_BETA"));

    await waitFor(() =>
      expect(screen.getByTestId("org-switcher-error")).toHaveTextContent(
        "errors.api.FORBIDDEN",
      ),
    );
    expect(sessionMock.current.switchOrganization).toHaveBeenCalledWith(
      "ORG_BETA",
    );
    expect(screen.getByTestId("org-switcher")).not.toBeDisabled();
  });

  it("shows an API error and restores pending state when switching space fails", async () => {
    sessionMock.current = {
      ...sessionMock.current,
      currentOrganization: {
        code: "alpha",
        id: "ORG_ALPHA",
        name: "Alpha",
        role: "ADMIN",
        status: "ACTIVE",
      },
      currentSpace: {
        code: "space-a",
        id: "SPC_A",
        name: "Space A",
        organizationId: "ORG_ALPHA",
        role: "PM",
        status: "ACTIVE",
      },
      spacesForCurrentOrganization: [
        {
          code: "space-a",
          id: "SPC_A",
          name: "Space A",
          organizationId: "ORG_ALPHA",
          role: "PM",
          status: "ACTIVE",
        },
        {
          code: "space-b",
          id: "SPC_B",
          name: "Space B",
          organizationId: "ORG_ALPHA",
          role: "DEVELOPER",
          status: "ACTIVE",
        },
      ],
    };
    sessionMock.current.switchSpace.mockRejectedValueOnce(
      new ApiClientError(
        {
          code: "SPACE_ACCESS_DENIED",
          message: "Denied",
          requestId: "req_space_switch",
        },
        new Response(null, { status: 403 }),
      ),
    );

    render(<OrganizationSwitcher />);

    fireEvent.click(screen.getByTestId("org-switcher-space-SPC_B"));

    await waitFor(() =>
      expect(screen.getByTestId("org-switcher-error")).toHaveTextContent(
        "errors.api.SPACE_ACCESS_DENIED",
      ),
    );
    expect(sessionMock.current.switchSpace).toHaveBeenCalledWith("SPC_B");
    expect(screen.getByTestId("org-switcher")).not.toBeDisabled();
  });
});
