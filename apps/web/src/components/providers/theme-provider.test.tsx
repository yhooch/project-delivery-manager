import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ThemeProvider, useTheme } from "./theme-provider";

type ThemeMode = "system" | "light" | "dark";

const mediaListeners = new Set<(event: MediaQueryListEvent) => void>();
const mediaQuery = "(prefers-color-scheme: dark)";
let prefersDark = false;

function ThemeProbe() {
  const { resolvedTheme, setTheme, theme } = useTheme();

  return (
    <div>
      <div data-testid="theme">{theme}</div>
      <div data-testid="resolved-theme">{resolvedTheme}</div>
      {(["system", "light", "dark"] satisfies ThemeMode[]).map((nextTheme) => (
        <button key={nextTheme} onClick={() => setTheme(nextTheme)}>
          set {nextTheme}
        </button>
      ))}
    </div>
  );
}

function renderThemeProvider() {
  render(
    <ThemeProvider>
      <ThemeProbe />
    </ThemeProvider>,
  );
}

function mockMatchMedia() {
  mediaListeners.clear();
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn((query: string) => ({
      get matches() {
        return prefersDark;
      },
      media: query,
      onchange: null,
      addEventListener: vi.fn(
        (event: string, listener: (event: MediaQueryListEvent) => void) => {
          if (event === "change") {
            mediaListeners.add(listener);
          }
        },
      ),
      removeEventListener: vi.fn(
        (event: string, listener: (event: MediaQueryListEvent) => void) => {
          if (event === "change") {
            mediaListeners.delete(listener);
          }
        },
      ),
      addListener: vi.fn((listener: (event: MediaQueryListEvent) => void) => {
        mediaListeners.add(listener);
      }),
      removeListener: vi.fn(
        (listener: (event: MediaQueryListEvent) => void) => {
          mediaListeners.delete(listener);
        },
      ),
      dispatchEvent: vi.fn(() => true),
    })),
  });
}

function setSystemPreference(nextPrefersDark: boolean) {
  prefersDark = nextPrefersDark;
  const event = new Event("change") as MediaQueryListEvent;
  Object.defineProperties(event, {
    matches: { value: nextPrefersDark },
    media: { value: mediaQuery },
  });

  act(() => {
    for (const listener of mediaListeners) {
      listener(event);
    }
  });
}

function expectAppliedTheme(theme: "light" | "dark") {
  expect(document.documentElement.classList.contains("dark")).toBe(
    theme === "dark",
  );
  expect(document.documentElement.style.colorScheme).toBe(theme);
}

beforeEach(() => {
  prefersDark = false;
  window.localStorage.clear();
  document.documentElement.className = "";
  document.documentElement.removeAttribute("style");
  mockMatchMedia();
});

describe("ThemeProvider", () => {
  it("defaults to system and resolves it from matchMedia", async () => {
    prefersDark = true;

    renderThemeProvider();

    await waitFor(() => {
      expect(screen.getByTestId("theme")).toHaveTextContent("system");
      expect(screen.getByTestId("resolved-theme")).toHaveTextContent("dark");
      expectAppliedTheme("dark");
    });
    expect(window.matchMedia).toHaveBeenCalledWith(mediaQuery);
  });

  it.each([
    ["light", "light"],
    ["dark", "dark"],
    ["system", "dark"],
  ] as const)(
    "reads %s from localStorage",
    async (storedTheme, expectedResolvedTheme) => {
      prefersDark = true;
      window.localStorage.setItem("theme", storedTheme);

      renderThemeProvider();

      await waitFor(() => {
        expect(screen.getByTestId("theme")).toHaveTextContent(storedTheme);
        expect(screen.getByTestId("resolved-theme")).toHaveTextContent(
          expectedResolvedTheme,
        );
        expectAppliedTheme(expectedResolvedTheme);
      });
    },
  );

  it("falls back to system when localStorage contains an invalid value", async () => {
    prefersDark = true;
    window.localStorage.setItem("theme", "sepia");

    renderThemeProvider();

    await waitFor(() => {
      expect(screen.getByTestId("theme")).toHaveTextContent("system");
      expect(screen.getByTestId("resolved-theme")).toHaveTextContent("dark");
      expectAppliedTheme("dark");
    });
  });

  it("setTheme updates localStorage, html.dark, and colorScheme", async () => {
    renderThemeProvider();

    fireEvent.click(screen.getByRole("button", { name: "set dark" }));

    await waitFor(() => {
      expect(window.localStorage.getItem("theme")).toBe("dark");
      expect(screen.getByTestId("theme")).toHaveTextContent("dark");
      expect(screen.getByTestId("resolved-theme")).toHaveTextContent("dark");
      expectAppliedTheme("dark");
    });

    fireEvent.click(screen.getByRole("button", { name: "set light" }));

    await waitFor(() => {
      expect(window.localStorage.getItem("theme")).toBe("light");
      expect(screen.getByTestId("theme")).toHaveTextContent("light");
      expect(screen.getByTestId("resolved-theme")).toHaveTextContent("light");
      expectAppliedTheme("light");
    });
  });

  it("responds to matchMedia changes while using system mode", async () => {
    renderThemeProvider();

    await waitFor(() => {
      expect(screen.getByTestId("theme")).toHaveTextContent("system");
      expectAppliedTheme("light");
    });

    setSystemPreference(true);

    await waitFor(() => {
      expect(screen.getByTestId("resolved-theme")).toHaveTextContent("dark");
      expectAppliedTheme("dark");
    });

    setSystemPreference(false);

    await waitFor(() => {
      expect(screen.getByTestId("resolved-theme")).toHaveTextContent("light");
      expectAppliedTheme("light");
    });
  });

  it("syncs theme from storage events", async () => {
    renderThemeProvider();

    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", { key: "theme", newValue: "dark" }),
      );
    });

    await waitFor(() => {
      expect(screen.getByTestId("theme")).toHaveTextContent("dark");
      expect(screen.getByTestId("resolved-theme")).toHaveTextContent("dark");
      expectAppliedTheme("dark");
    });

    prefersDark = false;
    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", { key: "theme", newValue: "system" }),
      );
    });

    await waitFor(() => {
      expect(screen.getByTestId("theme")).toHaveTextContent("system");
      expect(screen.getByTestId("resolved-theme")).toHaveTextContent("light");
      expectAppliedTheme("light");
    });
  });
});
