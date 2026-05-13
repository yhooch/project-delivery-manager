"use client";

import {
  Bug,
  ClipboardList,
  GitBranch,
  Inbox,
  LayoutDashboard,
  Settings,
} from "lucide-react";
import { useTranslations } from "next-intl";

import { Link, usePathname } from "../../i18n/routing";
import { useSession } from "../providers/session-provider";

const navItems = [
  {
    href: "/",
    icon: LayoutDashboard,
    key: "dashboard",
  },
  {
    href: "/intake-items",
    icon: Inbox,
    key: "intake",
  },
  {
    href: "/work-items",
    icon: ClipboardList,
    key: "workItems",
  },
  {
    href: "/bugs",
    icon: Bug,
    key: "bugs",
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
  const { currentSpace } = useSession();

  return (
    <nav className="sidebar-nav" aria-label={t("label")}>
      {navItems.map((item) => {
        const Icon = item.icon;
        const href =
          item.key === "intake" && currentSpace
            ? `/spaces/${currentSpace.id}/intake-items`
            : item.key === "workItems" && currentSpace
            ? `/spaces/${currentSpace.id}/work-items`
            : item.key === "bugs" && currentSpace
            ? `/spaces/${currentSpace.id}/bugs`
            : item.key === "workflow" && currentSpace
            ? `/spaces/${currentSpace.id}/workflow`
            : item.href;
        const isActive =
          item.key === "intake"
            ? pathname === "/intake-items" || pathname.endsWith("/intake-items")
            : item.key === "workItems"
            ? pathname === "/work-items" || pathname.endsWith("/work-items")
            : item.key === "bugs"
            ? pathname === "/bugs" || pathname.endsWith("/bugs")
            : item.key === "workflow"
            ? pathname === "/workflow" || pathname.endsWith("/workflow")
            : item.href === "/"
              ? pathname === "/"
              : pathname.startsWith(item.href);

        return (
          <Link
            aria-current={isActive ? "page" : undefined}
            className="sidebar-nav__link"
            href={href}
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
