import type {
  Locale,
  ThemeMode,
  UpdateUserPreferencesRequest,
} from "@project-delivery/shared";

export type NextThemeMode = "system" | "light" | "dark";

export function toThemeMode(theme: string | undefined): ThemeMode {
  if (theme === "light") {
    return "LIGHT";
  }

  if (theme === "dark") {
    return "DARK";
  }

  return "SYSTEM";
}

export function toNextThemeMode(themeMode: ThemeMode): NextThemeMode {
  if (themeMode === "LIGHT") {
    return "light";
  }

  if (themeMode === "DARK") {
    return "dark";
  }

  return "system";
}

export function mergePreferences(
  current: UpdateUserPreferencesRequest,
  patch: Partial<UpdateUserPreferencesRequest>,
): UpdateUserPreferencesRequest {
  return {
    locale: patch.locale ?? current.locale,
    themeMode: patch.themeMode ?? current.themeMode,
  };
}

export function isSupportedLocale(locale: string): locale is Locale {
  return locale === "zh-CN" || locale === "en-US";
}
