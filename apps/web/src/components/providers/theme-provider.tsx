"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

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

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: ThemeProviderProps) {
  const [theme, setThemeState] = useState<NextThemeMode>("system");
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>("light");

  useEffect(() => {
    const storedTheme = readStoredTheme();
    setThemeState(storedTheme);
    setResolvedTheme(resolveTheme(storedTheme));
  }, []);

  useEffect(() => {
    const apply = () => {
      const nextResolvedTheme = resolveTheme(theme);
      setResolvedTheme(nextResolvedTheme);
      applyThemeClass(nextResolvedTheme);
    };

    apply();

    if (theme !== "system") {
      return;
    }

    const media = window.matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", apply);

    return () => {
      media.removeEventListener("change", apply);
    };
  }, [theme]);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== STORAGE_KEY) {
        return;
      }

      setThemeState(normalizeTheme(event.newValue));
    };

    window.addEventListener("storage", onStorage);

    return () => {
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const setTheme = useCallback((nextTheme: NextThemeMode) => {
    setThemeState(nextTheme);
    window.localStorage.setItem(STORAGE_KEY, nextTheme);
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({ resolvedTheme, setTheme, theme }),
    [resolvedTheme, setTheme, theme],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useTheme() {
  const value = useContext(ThemeContext);

  if (!value) {
    throw new Error("useTheme must be used within ThemeProvider");
  }

  return value;
}

function readStoredTheme(): NextThemeMode {
  return normalizeTheme(window.localStorage.getItem(STORAGE_KEY));
}

function normalizeTheme(value: string | null): NextThemeMode {
  if (THEMES.has(value as NextThemeMode)) {
    return value as NextThemeMode;
  }

  return "system";
}

function resolveTheme(theme: NextThemeMode): ResolvedTheme {
  if (theme === "system") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }

  return theme;
}

function applyThemeClass(theme: ResolvedTheme): void {
  document.documentElement.classList.toggle("dark", theme === "dark");
  document.documentElement.style.colorScheme = theme;
}
