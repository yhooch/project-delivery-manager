import { cleanup, render, screen, within } from "@testing-library/react";
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useTranslations: (namespace?: string) => (key: string) =>
    namespace ? `${namespace}.${key}` : key,
}));

const pathnameMock = vi.hoisted(() => ({
  current: "/",
}));
vi.mock("../../i18n/routing", () => ({
  Link: ({
    children,
    href,
    ...props
  }: {
    children: ReactNode;
    href: string;
  } & AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
  usePathname: () => pathnameMock.current,
}));

const sessionMock = vi.hoisted(() => ({
  current: {
    currentOrganization: {
      id: "ORG_01",
      name: "Org",
      role: "MEMBER",
      status: "ACTIVE",
    },
  },
}));
vi.mock("../providers/session-provider", () => ({
  useSession: () => sessionMock.current,
}));

import { Sidebar } from "./sidebar";

beforeEach(() => {
  pathnameMock.current = "/";
  sessionMock.current = {
    currentOrganization: {
      id: "ORG_01",
      name: "Org",
      role: "MEMBER",
      status: "ACTIVE",
    },
  };
});

afterEach(() => {
  cleanup();
});

describe("Sidebar", () => {
  it("keeps primary nav but hides the organization entry for non-admin members", () => {
    render(<Sidebar />);

    expect(screen.getByText("shell.brand.shortName")).toBeInTheDocument();
    expect(screen.getByTestId("sidebar-nav-group-work")).toHaveTextContent(
      "shell.nav.group.work",
    );
    expect(screen.getByTestId("sidebar-nav-group-deliver")).toHaveTextContent(
      "shell.nav.group.deliver",
    );
    expect(screen.getByTestId("sidebar-nav-group-document")).toHaveTextContent(
      "shell.nav.group.document",
    );
    expect(screen.getByTestId("sidebar-nav-group-configure")).toHaveTextContent(
      "shell.nav.group.configure",
    );

    expect(
      screen.getByRole("link", { name: /shell\.nav\.workflow/u }),
    ).toHaveAttribute("href", "/workflow");
    expect(
      screen.getByRole("link", { name: /shell\.nav\.spaceSettings/u }),
    ).toHaveAttribute("href", "/settings");
    expect(
      screen.queryByTestId("sidebar-organization-section"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /shell\.nav\.organization/u }),
    ).not.toBeInTheDocument();
  });

  it("renders OWNER/ADMIN organization links inside a collapsible organization section", () => {
    pathnameMock.current = "/organization";
    sessionMock.current = {
      currentOrganization: {
        id: "ORG_01",
        name: "Org",
        role: "ADMIN",
        status: "ACTIVE",
      },
    };

    render(<Sidebar />);

    const section = screen.getByTestId("sidebar-organization-section");
    expect(section.tagName).toBe("DETAILS");
    expect(
      within(section).getByText("shell.nav.group.organization"),
    ).toBeInTheDocument();
    expect(
      within(section).getByRole("link", { name: /shell\.nav\.organization/u }),
    ).toHaveAttribute("href", "/organization");
  });
});
