"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  type ReactNode,
} from "react";
import {
  ThemeProvider as NextThemesProvider,
  useTheme as useNextThemes,
} from "next-themes";

import type { NextThemeMode } from "../../lib/preferences";

type ResolvedTheme = "light" | "dark";

type ThemeContextValue = {
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: NextThemeMode) => void;
  theme: NextThemeMode;
};

type ThemeProviderProps = {
  children: ReactNode;
};

const STORAGE_KEY = "theme";
const THEMES = new Set<NextThemeMode>(["system", "light", "dark"]);
const SCRIPT_PROPS = {
  "data-next-themes": "init",
};
const CLIENT_SCRIPT_PROPS = {
  ...SCRIPT_PROPS,
  type: "text/plain",
};

const ThemeProviderContext = createContext(false);

export function ThemeProvider({ children }: ThemeProviderProps) {
  return (
    <ThemeProviderContext.Provider value>
      <NextThemesProvider
        attribute="class"
        defaultTheme="system"
        enableSystem
        scriptProps={getScriptProps()}
        storageKey={STORAGE_KEY}
      >
        <ThemeValueGuard />
        {children}
      </NextThemesProvider>
    </ThemeProviderContext.Provider>
  );
}

function getScriptProps() {
  // React-created scripts never execute on client navigations, and React 19
  // warns for executable script tags. Keep the SSR initializer executable.
  if (typeof window === "undefined") return SCRIPT_PROPS;
  return CLIENT_SCRIPT_PROPS;
}

export function useTheme() {
  const hasProvider = useContext(ThemeProviderContext);
  const nextTheme = useNextThemes();

  if (!hasProvider) {
    throw new Error("useTheme must be used within ThemeProvider");
  }

  const setTheme = useCallback(
    (theme: NextThemeMode) => {
      nextTheme.setTheme(theme);
    },
    [nextTheme.setTheme],
  );

  return useMemo<ThemeContextValue>(
    () => ({
      resolvedTheme: normalizeResolvedTheme(nextTheme.resolvedTheme),
      setTheme,
      theme: normalizeTheme(nextTheme.theme),
    }),
    [nextTheme.resolvedTheme, nextTheme.theme, setTheme],
  );
}

function normalizeTheme(value: string | undefined): NextThemeMode {
  if (THEMES.has(value as NextThemeMode)) return value as NextThemeMode;
  return "system";
}

function normalizeResolvedTheme(value: string | undefined): ResolvedTheme {
  return value === "dark" ? "dark" : "light";
}

function ThemeValueGuard() {
  const { setTheme, theme } = useNextThemes();

  useEffect(() => {
    if (theme && !THEMES.has(theme as NextThemeMode)) {
      setTheme("system");
    }
  }, [setTheme, theme]);

  return null;
}
