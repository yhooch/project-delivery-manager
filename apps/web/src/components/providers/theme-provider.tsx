"use client";

import { ThemeProvider as NextThemesProvider, useTheme as useNextTheme } from "next-themes";
import type { ReactNode } from "react";

type ThemeProviderProps = {
  children: ReactNode;
};

/**
 * Application-level theme provider.
 * Uses `next-themes` under the hood so the initial paint, system-preference
 * tracking, cross-tab `storage` sync and SSR-safe hydration are all handled
 * for us. We keep the local export name so callers don't need to change.
 */
export function ThemeProvider({ children }: ThemeProviderProps) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
      themes={["light", "dark", "system"]}
    >
      {children}
    </NextThemesProvider>
  );
}

export function useTheme() {
  return useNextTheme();
}
