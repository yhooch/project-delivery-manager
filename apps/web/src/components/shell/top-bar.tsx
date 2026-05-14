"use client";

import { Search } from "lucide-react";
import { useTranslations } from "next-intl";

import { Kbd } from "../ui/kbd";

import { LanguageToggle } from "./language-toggle";
import { OrganizationSwitcher } from "./organization-switcher";
import { ThemeToggle } from "./theme-toggle";
import { UserMenu } from "./user-menu";
import { openCommandPalette } from "./command-palette";

export function TopBar() {
  const t = useTranslations("shell.topBar");

  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border bg-card/60 px-4 backdrop-blur">
      <OrganizationSwitcher />

      <div className="flex flex-1 justify-center">
        <button
          type="button"
          data-testid="command-palette-trigger"
          onClick={openCommandPalette}
          aria-label={t("commandLabel")}
          className="group flex h-7 w-full max-w-md items-center gap-2 rounded-md border border-border bg-background px-2.5 text-xs text-muted-foreground transition-colors hover:border-input hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 cursor-pointer"
        >
          <Search className="h-3.5 w-3.5" />
          <span className="flex-1 text-left">{t("commandPlaceholder")}</span>
          <span className="flex items-center gap-1">
            <Kbd>⌘</Kbd>
            <Kbd>K</Kbd>
          </span>
        </button>
      </div>

      <div className="flex items-center gap-1">
        <LanguageToggle />
        <ThemeToggle />
        <div className="ml-1 h-5 w-px bg-border" />
        <UserMenu />
      </div>
    </header>
  );
}
