"use client";

import { Menu, Search } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "../ui/button";
import { Kbd } from "../ui/kbd";

import { LanguageToggle } from "./language-toggle";
import { OrganizationSwitcher } from "./organization-switcher";
import { ThemeToggle } from "./theme-toggle";
import { UserMenu } from "./user-menu";
import { openCommandPalette } from "./command-palette";

type TopBarProps = {
  onOpenSidebar?: () => void;
};

export function TopBar({ onOpenSidebar }: TopBarProps) {
  const t = useTranslations("shell.topBar");

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-card/60 px-2.5 backdrop-blur sm:gap-3 sm:px-4">
      {onOpenSidebar && (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={t("navigationLabel")}
          onClick={onOpenSidebar}
          className="md:hidden"
        >
          <Menu className="h-3.5 w-3.5" />
        </Button>
      )}

      <div className="min-w-0 shrink [&_[data-testid=org-switcher]]:max-w-[132px] sm:[&_[data-testid=org-switcher]]:max-w-[260px]">
        <OrganizationSwitcher />
      </div>

      <div className="flex min-w-0 flex-1 justify-center">
        <button
          type="button"
          data-testid="command-palette-trigger"
          onClick={openCommandPalette}
          aria-label={t("commandLabel")}
          className="group flex h-7 w-8 shrink-0 items-center justify-center gap-2 rounded-md border border-border bg-background px-0 text-xs text-muted-foreground transition-colors hover:border-input hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 sm:w-full sm:max-w-md sm:justify-start sm:px-2.5 cursor-pointer"
        >
          <Search className="h-3.5 w-3.5" />
          <span className="hidden flex-1 text-left sm:inline">
            {t("commandPlaceholder")}
          </span>
          <span className="hidden items-center gap-1 sm:flex">
            <Kbd>⌘</Kbd>
            <Kbd>K</Kbd>
          </span>
        </button>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <LanguageToggle />
        <ThemeToggle />
        <div className="ml-1 h-5 w-px bg-border" />
        <UserMenu />
      </div>
    </header>
  );
}
