"use client";

import {
  AlertTriangle,
  Building2,
  CheckCircle2,
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
import { canManageOrganization } from "../../lib/space-service";
import { cn } from "../../lib/utils";

type NavItem = {
  href: string;
  label: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  shortcut?: string;
  match?: (pathname: string) => boolean;
};

type NavGroup = {
  key: string;
  label: string;
  items: NavItem[];
};

type SidebarProps = {
  className?: string;
  onNavigate?: () => void;
};

export function Sidebar({ className, onNavigate }: SidebarProps) {
  const tShell = useTranslations("shell.nav");
  const tBrand = useTranslations("shell.brand");
  const pathname = usePathname();
  const { currentOrganization } = useSession();

  const hasCurrentOrganization = Boolean(currentOrganization);
  const canManageCurrentOrganization = canManageOrganization(
    currentOrganization?.role,
  );

  if (!hasCurrentOrganization) {
    return null;
  }

  const groups: NavGroup[] = [
    {
      key: "work",
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
      key: "deliver",
      label: tShell("group.deliver"),
      items: [
        {
          href: "/overview",
          label: tShell("overview"),
          icon: LayoutDashboard,
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
      key: "document",
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
    {
      key: "configure",
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
    },
  ];
  const managementItems: NavItem[] = hasCurrentOrganization
    ? [
        {
          href: "/spaces",
          label: tShell("spaces"),
          icon: FolderKanban,
        },
        ...(canManageCurrentOrganization
          ? [
              {
                href: "/organization",
                label: tShell("organization"),
                icon: Building2,
              },
            ]
          : []),
      ]
    : [];

  return (
    <aside
      aria-label={tShell("label")}
      className={cn(
        "flex h-full w-56 shrink-0 flex-col border-r border-border bg-card/40",
        className,
      )}
    >
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3">
        <div className="flex h-6 w-6 items-center justify-center rounded-md bg-primary text-[11px] font-bold text-primary-foreground">
          {tBrand("shortName")}
        </div>
        <span className="text-sm font-semibold tracking-tight">
          {tShell("appName")}
        </span>
      </div>

      <nav className="flex flex-1 flex-col overflow-hidden p-2">
        <div className="flex flex-1 flex-col gap-3 overflow-y-auto">
          {groups.map((group) => (
            <div
              key={group.key}
              className="flex flex-col gap-0.5"
              data-testid={`sidebar-nav-group-${group.key}`}
            >
              <div className="px-2 pt-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                {group.label}
              </div>
              <ul className="flex flex-col gap-px">
                {group.items.map((item) => (
                  <SidebarLink
                    key={item.href}
                    item={item}
                    pathname={pathname}
                    onNavigate={onNavigate}
                  />
                ))}
              </ul>
            </div>
          ))}
        </div>

        {managementItems.length > 0 && (
          <div
            className="mt-2 shrink-0 border-t border-border pt-2"
            data-testid="sidebar-management-section"
          >
            <ul className="flex flex-col gap-px">
              {managementItems.map((item) => (
                <SidebarLink
                  key={item.href}
                  item={item}
                  pathname={pathname}
                  onNavigate={onNavigate}
                />
              ))}
            </ul>
          </div>
        )}
      </nav>
    </aside>
  );
}

function SidebarLink({
  item,
  onNavigate,
  pathname,
}: {
  item: NavItem;
  onNavigate?: () => void;
  pathname: string;
}) {
  const isActive = item.match
    ? item.match(pathname)
    : pathname === item.href || pathname.startsWith(`${item.href}/`);
  const Icon = item.icon;

  return (
    <li>
      <Link
        href={item.href}
        onClick={onNavigate}
        className={cn(
          "group flex h-7 items-center gap-2 rounded-md px-2 text-[13px] transition-colors [@media(pointer:coarse)]:h-11",
          isActive
            ? "bg-muted text-foreground font-medium"
            : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
        )}
      >
        <Icon
          className={cn("h-3.5 w-3.5 shrink-0", isActive && "text-primary")}
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
}
