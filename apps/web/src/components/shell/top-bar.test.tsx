import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useTranslations: (namespace?: string) => (key: string) =>
    namespace ? `${namespace}.${key}` : key,
}));

const openCommandPaletteMock = vi.hoisted(() => vi.fn());
vi.mock("./command-palette", () => ({
  openCommandPalette: openCommandPaletteMock,
}));
vi.mock("./language-toggle", () => ({
  LanguageToggle: () => <button type="button">language-toggle</button>,
}));
vi.mock("./organization-switcher", () => ({
  OrganizationSwitcher: () => (
    <div data-testid="org-switcher">organization-switcher</div>
  ),
}));
vi.mock("./theme-toggle", () => ({
  ThemeToggle: () => <button type="button">theme-toggle</button>,
}));
vi.mock("./user-menu", () => ({
  UserMenu: () => <button type="button">user-menu</button>,
}));

import { TopBar } from "./top-bar";

beforeEach(() => {
  openCommandPaletteMock.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("TopBar", () => {
  it("renders navigation and command controls when shell navigation is enabled", () => {
    const onOpenSidebar = vi.fn();

    render(<TopBar onOpenSidebar={onOpenSidebar} />);

    fireEvent.click(
      screen.getByRole("button", { name: "shell.topBar.navigationLabel" }),
    );
    expect(onOpenSidebar).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId("command-palette-trigger"));
    expect(openCommandPaletteMock).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("org-switcher")).toBeInTheDocument();
    expect(screen.getByText("language-toggle")).toBeInTheDocument();
    expect(screen.getByText("theme-toggle")).toBeInTheDocument();
    expect(screen.getByText("user-menu")).toBeInTheDocument();
  });

  it("hides space navigation and command trigger when shell navigation is disabled", () => {
    render(<TopBar commandPaletteEnabled={false} />);

    expect(
      screen.queryByRole("button", { name: "shell.topBar.navigationLabel" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("command-palette-trigger"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("org-switcher")).toBeInTheDocument();
    expect(screen.getByText("language-toggle")).toBeInTheDocument();
    expect(screen.getByText("theme-toggle")).toBeInTheDocument();
    expect(screen.getByText("user-menu")).toBeInTheDocument();
  });
});
