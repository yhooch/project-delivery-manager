"use client";

import { BookOpen, ChevronLeft, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, type ReactNode } from "react";

import { Link } from "../../i18n/routing";
import { RealtimeProvider } from "../../lib/realtime";
import { useSession } from "../providers/session-provider";
import { Button } from "../ui/button";
import { CommandPalette, useCommandPaletteShortcut } from "../shell/command-palette";

type DocumentShellProps = {
  children: ReactNode;
};

export function DocumentShell({ children }: DocumentShellProps) {
  const t = useTranslations("shell.documents");
  const tShell = useTranslations("shell");
  const tRoot = useTranslations();
  const {
    currentOrganization,
    currentSpace,
    initializeSession,
    session,
    sessionErrorKey,
    status,
  } = useSession();
  const hasOrganization = Boolean(currentOrganization);

  useCommandPaletteShortcut({ enabled: hasOrganization });

  useEffect(() => {
    document.title = t("documentTitle");
  }, [t]);

  if (status === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <section className="max-w-sm text-center" role="alert">
          <h1 className="text-base font-semibold text-foreground">
            {tShell("sessionError.title")}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {tShell("sessionError.description")}
          </p>
          <p className="mt-2 text-sm text-destructive">
            {tRoot(sessionErrorKey ?? "errors.api.UNKNOWN")}
          </p>
          <Button
            className="mt-4"
            size="sm"
            type="button"
            onClick={() => void initializeSession()}
          >
            {tShell("sessionError.retry")}
          </Button>
        </section>
      </div>
    );
  }

  if (status === "unauthenticated" || !session) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <section className="max-w-sm text-center">
          <h1 className="text-base font-semibold text-foreground">
            {tShell("unauthenticated.title")}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {tShell("unauthenticated.description")}
          </p>
          <Button asChild className="mt-4" size="sm">
            <Link href="/login">{tShell("unauthenticated.action")}</Link>
          </Button>
        </section>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-30 flex h-12 items-center justify-between border-b border-border bg-background/95 px-4 backdrop-blur md:px-6">
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-foreground text-background">
            <BookOpen className="h-4 w-4" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">{t("title")}</div>
            <div className="hidden truncate text-[11px] text-muted-foreground sm:block">
              {currentSpace?.name ?? t("noSpace")}
            </div>
          </div>
        </div>
        <Button asChild size="sm" variant="outline">
          <Link href="/">
            <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
            {t("backToWorkspace")}
          </Link>
        </Button>
      </header>
      <main className="min-h-[calc(100vh-3rem)]">
        <RealtimeProvider
          organizationId={currentOrganization?.id ?? session.defaultOrganizationId}
          spaceId={currentSpace?.id ?? session.defaultSpaceId}
        >
          {children}
        </RealtimeProvider>
      </main>
      {hasOrganization ? <CommandPalette /> : null}
    </div>
  );
}
