"use client";

import { FolderKanban, Loader2, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState, type ReactNode } from "react";

import { Link, usePathname } from "../../i18n/routing";
import { RealtimeProvider } from "../../lib/realtime";
import { canCreateSpaceInOrganization } from "../../lib/space-service";
import { useSession } from "../providers/session-provider";
import { Button } from "../ui/button";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "../ui/sheet";

import { CommandPalette, useCommandPaletteShortcut } from "./command-palette";
import { Sidebar } from "./sidebar";
import { TopBar } from "./top-bar";
import { OnboardingEmpty } from "./onboarding-empty";
import { CreateSpaceDialog } from "./create-space-dialog";

type AppShellProps = {
  children: ReactNode;
};

export function AppShell({ children }: AppShellProps) {
  const {
    currentOrganization,
    currentSpace,
    initializeSession,
    session,
    sessionErrorKey,
    spacesForCurrentOrganization,
    status,
  } = useSession();
  const t = useTranslations("shell");
  const tRoot = useTranslations();
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [createSpaceOpen, setCreateSpaceOpen] = useState(false);
  const hasOrganization = Boolean(currentOrganization);
  const hasNoSpacesInCurrentOrganization =
    hasOrganization &&
    spacesForCurrentOrganization.length === 0 &&
    !currentSpace;
  const bypassNoSpacesEmpty = isNoSpaceBypassPath(pathname);
  const canCreateSpace = Boolean(
    session?.capabilities?.canCreateSpace &&
      canCreateSpaceInOrganization(
        currentOrganization?.role,
        currentOrganization?.status,
      ),
  );
  const realtimeSpaceId = isOrganizationWideRealtimePath(pathname)
    ? undefined
    : currentSpace?.id;
  useCommandPaletteShortcut({ enabled: hasOrganization });

  useEffect(() => {
    document.title = t("documentTitle");
  }, [t]);

  if (status === "loading") {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="flex h-screen items-center justify-center bg-background px-4">
        <section
          aria-live="assertive"
          className="flex max-w-sm flex-col items-center gap-3 text-center"
          role="alert"
        >
          <h1 className="text-base font-semibold text-foreground">
            {t("sessionError.title")}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t("sessionError.description")}
          </p>
          <p className="text-sm text-destructive">
            {tRoot(sessionErrorKey ?? "errors.api.UNKNOWN")}
          </p>
          <Button
            size="sm"
            type="button"
            onClick={() => void initializeSession()}
          >
            {t("sessionError.retry")}
          </Button>
        </section>
      </div>
    );
  }

  if (status === "unauthenticated" || !session) {
    return (
      <div className="flex h-screen items-center justify-center bg-background px-4">
        <section
          aria-live="polite"
          className="flex max-w-sm flex-col items-center gap-3 text-center"
        >
          <h1 className="text-base font-semibold text-foreground">
            {t("unauthenticated.title")}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t("unauthenticated.description")}
          </p>
          <Button asChild size="sm">
            <Link href="/login">{t("unauthenticated.action")}</Link>
          </Button>
        </section>
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {hasOrganization && (
        <>
          <Sidebar className="hidden md:flex" />
          <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
            <SheetContent side="left" className="w-[82vw] max-w-xs p-0">
              <SheetTitle className="sr-only">{t("nav.label")}</SheetTitle>
              <SheetDescription className="sr-only">
                {t("mobileNav.description")}
              </SheetDescription>
              <Sidebar
                className="w-full border-r-0 bg-card"
                onNavigate={() => setSidebarOpen(false)}
              />
            </SheetContent>
          </Sheet>
        </>
      )}
      <div className="flex flex-1 flex-col overflow-hidden">
        <TopBar
          commandPaletteEnabled={hasOrganization}
          onOpenSidebar={
            hasOrganization ? () => setSidebarOpen(true) : undefined
          }
        />
        <main className="flex-1 overflow-auto bg-background">
          {!hasOrganization ? (
            <OnboardingEmpty />
          ) : hasNoSpacesInCurrentOrganization && !bypassNoSpacesEmpty ? (
            <div
              data-testid="app-shell-no-spaces-empty"
              className="flex h-full items-center justify-center px-4"
            >
              <div className="max-w-md text-center">
                <div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/15 text-primary">
                  <FolderKanban className="h-6 w-6" />
                </div>
                <h1 className="text-lg font-semibold tracking-tight">
                  {t("noSpaces.title")}
                </h1>
                <p className="mt-2 text-sm text-muted-foreground">
                  {t("noSpaces.description")}
                </p>
                {canCreateSpace ? (
                  <Button
                    size="lg"
                    className="mt-5"
                    data-testid="app-shell-create-space-button"
                    onClick={() => setCreateSpaceOpen(true)}
                  >
                    <Plus className="h-4 w-4" />
                    {t("organizationSwitcher.createSpace")}
                  </Button>
                ) : null}
                <p className="mt-3 text-xs text-muted-foreground">
                  {t("noSpaces.waitingHint")}
                </p>
              </div>
            </div>
          ) : (
            <RealtimeProvider
              organizationId={currentOrganization?.id}
              spaceId={realtimeSpaceId}
            >
              {children}
            </RealtimeProvider>
          )}
        </main>
      </div>
      {hasOrganization && <CommandPalette />}
      {currentOrganization ? (
        <CreateSpaceDialog
          open={createSpaceOpen}
          onOpenChange={setCreateSpaceOpen}
          organizationId={currentOrganization.id}
        />
      ) : null}
    </div>
  );
}

function isOrganizationWideRealtimePath(pathname: string): boolean {
  const normalized = pathname.replace(/\/+$/u, "") || "/";
  return normalized === "/" || normalized === "/upgrade";
}

function isNoSpaceBypassPath(pathname: string): boolean {
  return (pathname.replace(/\/+$/u, "") || "/") === "/upgrade";
}
