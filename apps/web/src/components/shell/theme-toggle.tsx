"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "../ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { useSession } from "../providers/session-provider";
import { useTheme } from "../providers/theme-provider";
import { toThemeMode, type NextThemeMode } from "../../lib/preferences";

const ICONS: Record<NextThemeMode, typeof Sun> = {
  system: Monitor,
  light: Sun,
  dark: Moon,
};

export function ThemeToggle() {
  const t = useTranslations("common.theme");
  const { theme, resolvedTheme, setTheme } = useTheme();
  const { session, persistPreferences } = useSession();
  const Icon = ICONS[resolvedTheme === "dark" ? "dark" : "light"];

  const handleSelect = (mode: NextThemeMode) => {
    setTheme(mode);
    if (session) {
      void persistPreferences({ themeMode: toThemeMode(mode) });
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t("label")}
          title={t("label")}
        >
          <Icon className="h-3.5 w-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-32">
        {(["system", "light", "dark"] as NextThemeMode[]).map((mode) => {
          const ItemIcon = ICONS[mode];
          return (
            <DropdownMenuItem
              key={mode}
              onSelect={() => handleSelect(mode)}
              className="text-xs"
            >
              <ItemIcon className="h-3.5 w-3.5 text-muted-foreground" />
              <span>{t(`${mode}.label`)}</span>
              {theme === mode && (
                <span className="ml-auto h-1.5 w-1.5 rounded-full bg-primary" />
              )}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
