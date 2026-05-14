"use client";

import { ChevronLeft } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { Link } from "../../i18n/routing";

type RequirementNotionShellProps = {
  children: ReactNode;
};

/**
 * Outer chrome for the requirement detail route — applies a Notion-style
 * sticky breadcrumb header and centers the existing workspace content in
 * a comfortable max-width column. The inner workspace keeps its own layout
 * and form behavior; this component only provides the page frame.
 */
export function RequirementNotionShell({ children }: RequirementNotionShellProps) {
  const tNav = useTranslations("shell.nav");
  const tReq = useTranslations("requirements");

  return (
    <div data-testid="requirement-detail-page" className="flex h-full flex-col">
      <header className="sticky top-0 z-10 border-b border-border bg-background/85 px-6 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/70">
        <div className="mx-auto flex max-w-[1080px] items-center gap-2 text-xs text-muted-foreground">
          <Link
            href="/requirements"
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 transition hover:bg-muted hover:text-foreground"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            <span>{tNav("requirements")}</span>
          </Link>
          <span className="text-muted-foreground/60">/</span>
          <span className="truncate text-foreground/90">
            {tReq("detail.breadcrumbCurrent", {
              default: "Detail",
            })}
          </span>
        </div>
      </header>
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[1080px] px-6 py-6">{children}</div>
      </div>
    </div>
  );
}
