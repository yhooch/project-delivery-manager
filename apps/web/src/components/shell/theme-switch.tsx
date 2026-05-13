"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { toThemeMode } from "../../lib/preferences";
import { useSession } from "../providers/session-provider";

const themeOptions = ["system", "light", "dark"] as const;

type ThemeOption = (typeof themeOptions)[number];

const themeIcons = {
  dark: Moon,
  light: Sun,
  system: Monitor,
} satisfies Record<ThemeOption, typeof Monitor>;

export function ThemeSwitch() {
  const t = useTranslations("common.theme");
  const { setTheme, theme } = useTheme();
  const { persistPreferences, session } = useSession();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const activeTheme = mounted ? (theme ?? "system") : "system";

  return (
    <div className="segmented-control" role="group" aria-label={t("label")}>
      {themeOptions.map((option) => {
        const Icon = themeIcons[option];
        const isActive = activeTheme === option;

        return (
          <button
            aria-label={t(`${option}.ariaLabel`)}
            aria-pressed={isActive}
            className="segmented-control__button"
            key={option}
            onClick={() => {
              setTheme(option);

              if (session) {
                void persistPreferences({ themeMode: toThemeMode(option) });
              }
            }}
            title={t(`${option}.label`)}
            type="button"
          >
            <Icon aria-hidden="true" size={16} strokeWidth={2} />
            <span className="sr-only">{t(`${option}.label`)}</span>
          </button>
        );
      })}
    </div>
  );
}
