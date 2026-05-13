"use client";

import { Bell, Search, ShieldCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { LanguageSwitch } from "./language-switch";
import { LogoutButton } from "./logout-button";
import { OrganizationSwitcher } from "./organization-switcher";
import { SidebarNav } from "./sidebar-nav";
import { SpaceSwitcher } from "./space-switcher";
import { ThemeSwitch } from "./theme-switch";
import { useSession } from "../providers/session-provider";

type AppShellProps = {
  children: ReactNode;
};

export function AppShell({ children }: AppShellProps) {
  const t = useTranslations("shell");
  const { session, status } = useSession();
  const statusValue =
    status === "authenticated" && session
      ? t("status.signedIn", { username: session.user.username })
      : t(`status.${status}`);

  return (
    <div className="app-shell">
      <aside className="app-shell__sidebar">
        <div className="brand-lockup" aria-label={t("brand.name")}>
          <div className="brand-lockup__mark" aria-hidden="true">
            {t("brand.shortName")}
          </div>
          <div className="brand-lockup__text">
            <span className="brand-lockup__name">{t("brand.name")}</span>
            <span className="brand-lockup__meta">{t("brand.subtitle")}</span>
          </div>
        </div>
        <SidebarNav />
        <div className="sidebar-status">
          <ShieldCheck aria-hidden="true" size={16} strokeWidth={2} />
          <div>
            <span className="sidebar-status__label">{t("status.label")}</span>
            <span className="sidebar-status__value">{statusValue}</span>
          </div>
        </div>
      </aside>
      <div className="app-shell__workspace">
        <header className="topbar">
          <div className="topbar__title-group">
            <span className="topbar__eyebrow">{t("topbar.eyebrow")}</span>
            <h1 className="topbar__title">{t("topbar.title")}</h1>
          </div>
          <div className="topbar__tools">
            <OrganizationSwitcher />
            <SpaceSwitcher />
            <div className="command-search" aria-label={t("search.label")}>
              <Search aria-hidden="true" size={16} strokeWidth={2} />
              <span>{t("search.placeholder")}</span>
            </div>
            <button
              aria-label={t("notifications.ariaLabel")}
              className="icon-button"
              title={t("notifications.label")}
              type="button"
            >
              <Bell aria-hidden="true" size={17} strokeWidth={2} />
            </button>
            <LanguageSwitch />
            <ThemeSwitch />
            <LogoutButton />
          </div>
        </header>
        <main className="app-shell__content">{children}</main>
      </div>
    </div>
  );
}
