import { act, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";

const themeSetMock = vi.hoisted(() => vi.fn());
const themeState = vi.hoisted(() => ({
  current: {
    resolvedTheme: "dark" as const,
    setTheme: themeSetMock,
    theme: "dark" as const,
  },
}));
const persistPreferencesMock = vi.hoisted(() => vi.fn());

vi.mock("next-intl", () => ({
  useTranslations: (namespace?: string) => (key: string) =>
    namespace ? `${namespace}.${key}` : key,
}));

vi.mock("../providers/session-provider", () => ({
  useSession: () => ({
    persistPreferences: persistPreferencesMock,
    session: null,
  }),
}));

vi.mock("../providers/theme-provider", () => ({
  useTheme: () => themeState.current,
}));

import { ThemeToggle } from "./theme-toggle";

beforeEach(() => {
  themeSetMock.mockReset();
  persistPreferencesMock.mockReset();
  document.body.innerHTML = "";
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("ThemeToggle", () => {
  it("keeps the SSR icon stable until the client theme has mounted", async () => {
    const serverHtml = renderToString(<ThemeToggle />);

    expect(serverHtml).toContain('data-testid="theme-toggle"');
    expect(serverHtml).toContain("opacity-0");
    expect(serverHtml).not.toContain("lucide-moon");

    const container = document.createElement("div");
    container.innerHTML = serverHtml;
    document.body.appendChild(container);

    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    let root: Root | undefined;
    try {
      await act(async () => {
        root = hydrateRoot(container, <ThemeToggle />);
      });

      await waitFor(() => {
        expect(screen.getByTestId("theme-toggle")).toBeInTheDocument();
        expect(container.querySelector(".lucide-moon")).toBeInTheDocument();
      });

      expect(consoleError.mock.calls.flat().join("\n")).not.toMatch(
        /hydration/i,
      );
    } finally {
      await act(async () => {
        root?.unmount();
      });
      consoleError.mockRestore();
    }
  });
});
