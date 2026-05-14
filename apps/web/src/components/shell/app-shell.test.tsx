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

const sessionMock = vi.hoisted(() => ({
  current: {
    session: null,
    status: "unauthenticated" as const,
  },
}));
vi.mock("../providers/session-provider", () => ({
  useSession: () => sessionMock.current,
}));

vi.mock("./command-palette", () => ({
  CommandPalette: () => <div data-testid="command-palette" />,
  useCommandPaletteShortcut: () => undefined,
}));
vi.mock("./onboarding-empty", () => ({
  OnboardingEmpty: () => <div data-testid="onboarding-empty" />,
}));
vi.mock("./sidebar", () => ({
  Sidebar: () => <aside data-testid="sidebar" />,
}));
vi.mock("./top-bar", () => ({
  TopBar: () => <header data-testid="top-bar" />,
}));

import { AppShell } from "./app-shell";

beforeEach(() => {
  sessionMock.current = {
    session: null,
    status: "unauthenticated" as const,
  };
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
});
