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
import { themeMediaQuery, themeStorageKey } from "../../lib/theme-script";

type ThemeProviderProps = {
  children: ReactNode;
};

type ResolvedThemeMode = "light" | "dark";

type ThemeContextValue = {
  resolvedTheme: ResolvedThemeMode;
  setTheme: (theme: NextThemeMode) => void;
  systemTheme: ResolvedThemeMode;
  theme: NextThemeMode;
  themes: NextThemeMode[];
};

const defaultTheme: NextThemeMode = "system";
const fallbackSystemTheme: ResolvedThemeMode = "light";
const themes = ["light", "dark", "system"] satisfies NextThemeMode[];

const fallbackThemeContext: ThemeContextValue = {
  resolvedTheme: fallbackSystemTheme,
  setTheme: () => {},
  systemTheme: fallbackSystemTheme,
  theme: defaultTheme,
  themes,
};

const ThemeContext = createContext<ThemeContextValue>(fallbackThemeContext);

export function ThemeProvider({ children }: ThemeProviderProps) {
  const [theme, setThemeState] = useState<NextThemeMode>(getStoredTheme);
  const [systemTheme, setSystemTheme] =
    useState<ResolvedThemeMode>(getSystemTheme);

  const resolvedTheme = resolveTheme(theme, systemTheme);

  useEffect(() => {
    applyTheme(theme, systemTheme);
  }, [systemTheme, theme]);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") {
      return;
    }

    const mediaQuery = window.matchMedia(themeMediaQuery);
    const handleChange = () => {
      setSystemTheme(getSystemTheme());
    };

    handleChange();

    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", handleChange);

      return () => {
        mediaQuery.removeEventListener("change", handleChange);
      };
    }

    mediaQuery.addListener(handleChange);

    return () => {
      mediaQuery.removeListener(handleChange);
    };
  }, []);

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== themeStorageKey) {
        return;
      }

      setThemeState(toThemeMode(event.newValue));
    };

    window.addEventListener("storage", handleStorage);

    return () => {
      window.removeEventListener("storage", handleStorage);
    };
  }, []);

  const setTheme = useCallback((nextTheme: NextThemeMode) => {
    setThemeState(nextTheme);

    try {
      window.localStorage.setItem(themeStorageKey, nextTheme);
    } catch {
      return;
    }
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({
      resolvedTheme,
      setTheme,
      systemTheme,
      theme,
      themes,
    }),
    [resolvedTheme, setTheme, systemTheme, theme],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}

function getStoredTheme(): NextThemeMode {
  if (typeof window === "undefined") {
    return defaultTheme;
  }

  try {
    return toThemeMode(window.localStorage.getItem(themeStorageKey));
  } catch {
    return defaultTheme;
  }
}

function toThemeMode(value: string | null): NextThemeMode {
  if (value === "light" || value === "dark" || value === "system") {
    return value;
  }

  return defaultTheme;
}

function getSystemTheme(): ResolvedThemeMode {
  if (
    typeof window === "undefined" ||
    typeof window.matchMedia !== "function"
  ) {
    return fallbackSystemTheme;
  }

  return window.matchMedia(themeMediaQuery).matches ? "dark" : "light";
}

function resolveTheme(
  theme: NextThemeMode,
  systemTheme: ResolvedThemeMode,
): ResolvedThemeMode {
  return theme === "system" ? systemTheme : theme;
}

function applyTheme(theme: NextThemeMode, systemTheme: ResolvedThemeMode) {
  const resolvedTheme = resolveTheme(theme, systemTheme);
  const root = document.documentElement;

  root.classList.remove("light", "dark");
  root.classList.add(resolvedTheme);
  root.style.colorScheme = resolvedTheme;
}
