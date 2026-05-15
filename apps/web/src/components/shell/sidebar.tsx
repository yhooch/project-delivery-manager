"use client";

import {
  AlertTriangle,
  CheckCircle2,
  Cog,
  FileText,
  FolderKanban,
  GitBranch,
  Inbox,
  LayoutDashboard,
  Settings2,
  ShieldAlert,
  Target,
  Workflow,
} from "lucide-react";
import { useTranslations } from "next-intl";
import type { ComponentType, SVGProps } from "react";

import { useSession } from "../providers/session-provider";

import { Link, usePathname } from "../../i18n/routing";
import { cn } from "../../lib/utils";

type NavItem = {
  href: string;
  label: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  shortcut?: string;
  match?: (pathname: string) => boolean;
};

type NavGroup = {
  label: string;
  items: NavItem[];
};

export function Sidebar() {
  const tShell = useTranslations("shell.nav");
  const pathname = usePathname();
  const { currentOrganization, currentSpace } = useSession();

  const isAdmin =
    currentOrganization?.role === "OWNER" ||
    currentOrganization?.role === "ADMIN";
  const isSpaceManager =
    currentSpace?.role === "SPACE_ADMIN" || currentSpace?.role === "PM";

  const groups: NavGroup[] = [
    {
      label: tShell("group.work"),
      items: [
        {
          href: "/",
          label: tShell("workbench"),
          icon: Inbox,
          shortcut: "G I",
          match: (path) => path === "/",
        },
      ],
    },
    {
      label: tShell("group.deliver"),
      items: [
        {
          href: "/overview",
          label: tShell("overview"),
          icon: LayoutDashboard,
        },
        {
          href: "/spaces",
          label: tShell("spaces"),
          icon: FolderKanban,
        },
        {
          href: "/versions",
          label: tShell("versions"),
          icon: GitBranch,
          shortcut: "G V",
        },
        {
          href: "/work-items",
          label: tShell("tasks"),
          icon: CheckCircle2,
        },
        {
          href: "/bugs",
          label: tShell("bugs"),
          icon: ShieldAlert,
          shortcut: "G B",
        },
        {
          href: "/exceptions",
          label: tShell("exceptions"),
          icon: AlertTriangle,
        },
      ],
    },
    {
      label: tShell("group.document"),
      items: [
        {
          href: "/requirements",
          label: tShell("requirements"),
          icon: FileText,
          shortcut: "G R",
        },
        {
          href: "/intake-items",
          label: tShell("intake"),
          icon: Target,
        },
      ],
    },
  ];

  if (isSpaceManager) {
    groups.push({
      label: tShell("group.configure"),
      items: [
        {
          href: "/workflow",
          label: tShell("workflow"),
          icon: Workflow,
        },
        {
          href: "/settings",
          label: tShell("spaceSettings"),
          icon: Settings2,
        },
      ],
    });
  }

  return (
    <aside className="flex h-full w-56 shrink-0 flex-col border-r border-border bg-card/40">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3">
        <div className="flex h-6 w-6 items-center justify-center rounded-md bg-primary text-[11px] font-bold text-primary-foreground">
          PD
        </div>
        <span className="text-sm font-semibold tracking-tight">
          {tShell("appName")}
        </span>
      </div>

      <nav className="flex flex-1 flex-col gap-3 overflow-y-auto p-2">
        {groups.map((group) => (
          <div key={group.label} className="flex flex-col gap-0.5">
            <div className="px-2 pt-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              {group.label}
            </div>
            <ul className="flex flex-col gap-px">
              {group.items.map((item) => {
                const isActive = item.match
                  ? item.match(pathname)
                  : pathname === item.href || pathname.startsWith(`${item.href}/`);
                const Icon = item.icon;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className={cn(
                        "group flex h-7 items-center gap-2 rounded-md px-2 text-[13px] transition-colors",
                        isActive
                          ? "bg-muted text-foreground font-medium"
                          : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                      )}
                    >
                      <Icon
                        className={cn(
                          "h-3.5 w-3.5 shrink-0",
                          isActive && "text-primary",
                        )}
                      />
                      <span className="flex-1 truncate">{item.label}</span>
                      {item.shortcut && (
                        <span className="hidden text-[10px] text-muted-foreground/60 group-hover:inline-block">
                          {item.shortcut}
                        </span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      {isAdmin && (
        <div className="shrink-0 border-t border-border p-2">
          <Link
            href="/organization"
            className={cn(
              "flex h-7 items-center gap-2 rounded-md px-2 text-[12px] text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground",
            )}
          >
            <Cog className="h-3.5 w-3.5" />
            <span className="flex-1 truncate">{tShell("organization")}</span>
          </Link>
        </div>
      )}
    </aside>
  );
}
