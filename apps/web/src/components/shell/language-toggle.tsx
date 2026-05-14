"use client";

import { Languages } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import { Button } from "../ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { useSession } from "../providers/session-provider";
import type { Locale } from "../../i18n/locales";
import { locales } from "../../i18n/locales";
import { usePathname, useRouter } from "../../i18n/routing";

export function LanguageToggle() {
  const t = useTranslations("common.language");
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const { session, persistPreferences } = useSession();

  const handleSelect = (next: Locale) => {
    if (next === locale) return;
    router.replace(pathname, { locale: next });
    if (session) {
      void persistPreferences({ locale: next });
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
          data-testid="language-toggle"
        >
          <Languages className="h-3.5 w-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-32">
        {locales.map((value) => (
          <DropdownMenuItem
            key={value}
            onSelect={() => handleSelect(value)}
            className="text-xs"
          >
            <span className="font-mono text-[10px] text-muted-foreground">
              {t(`${value}.shortLabel`)}
            </span>
            <span>{value === "zh-CN" ? "中文" : "English"}</span>
            {value === locale && (
              <span className="ml-auto h-1.5 w-1.5 rounded-full bg-primary" />
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
