"use client";

import {
  ClipboardList,
  GitBranch,
  Inbox,
  LayoutDashboard,
  Settings,
} from "lucide-react";
import { useTranslations } from "next-intl";

import { Link, usePathname } from "../../i18n/routing";

const navItems = [
  {
    href: "/",
    icon: LayoutDashboard,
    key: "dashboard",
  },
  {
    href: "/intake",
    icon: Inbox,
    key: "intake",
  },
  {
    href: "/work-items",
    icon: ClipboardList,
    key: "workItems",
  },
  {
    href: "/workflow",
    icon: GitBranch,
    key: "workflow",
  },
  {
    href: "/settings",
    icon: Settings,
    key: "settings",
  },
] as const;

export function SidebarNav() {
  const t = useTranslations("shell.nav");
  const pathname = usePathname();

  return (
    <nav className="sidebar-nav" aria-label={t("label")}>
      {navItems.map((item) => {
        const Icon = item.icon;
        const isActive =
          item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);

        return (
          <Link
            aria-current={isActive ? "page" : undefined}
            className="sidebar-nav__link"
            href={item.href}
            key={item.key}
          >
            <Icon aria-hidden="true" size={16} strokeWidth={2} />
            <span>{t(`${item.key}.label`)}</span>
          </Link>
        );
      })}
    </nav>
  );
}
