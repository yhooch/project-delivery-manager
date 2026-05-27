"use client";

import { BookOpen, ChevronLeft, FilePlus2, Loader2, Upload } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { Link, useRouter } from "../../i18n/routing";
import { RealtimeProvider } from "../../lib/realtime";
import { useSession } from "../providers/session-provider";
import { Button } from "../ui/button";
import { CommandPalette, useCommandPaletteShortcut } from "../shell/command-palette";
import { DocumentCreateProvider } from "./document-create-context";
import {
  DocumentImportDialog,
  DocumentPasteDialog,
} from "./documents-page";

type DocumentShellProps = {
  children: ReactNode;
};

export function DocumentShell({ children }: DocumentShellProps) {
  const t = useTranslations("shell.documents");
  const tShell = useTranslations("shell");
  const tRoot = useTranslations();
  const tCreate = useTranslations("documents.home");
  const router = useRouter();
  const {
    currentOrganization,
    currentSpace,
    initializeSession,
    session,
    sessionErrorKey,
    status,
  } = useSession();
  const hasOrganization = Boolean(currentOrganization);
  const [importOpen, setImportOpen] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);

  const createActions = useMemo(
    () => ({
      openImport: () => setImportOpen(true),
      openPaste: () => setPasteOpen(true),
    }),
    [],
  );

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

  const organizationId = currentOrganization?.id ?? session.defaultOrganizationId;
  const spaceId = currentSpace?.id ?? session.defaultSpaceId;

  return (
    <DocumentCreateProvider value={createActions}>
      <div className="min-h-screen bg-background text-foreground">
        <header className="sticky top-0 z-30 flex h-12 items-center justify-between gap-2 border-b border-border bg-background/95 px-4 backdrop-blur md:px-6">
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
          <div className="flex shrink-0 items-center gap-2">
            {hasOrganization ? (
              <>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  aria-label={tCreate("paste")}
                  onClick={createActions.openPaste}
                  data-testid="documents-paste-button"
                >
                  <FilePlus2 className="h-4 w-4" aria-hidden="true" />
                  <span className="hidden sm:inline">{tCreate("paste")}</span>
                </Button>
                <Button
                  type="button"
                  size="sm"
                  aria-label={tCreate("import")}
                  onClick={createActions.openImport}
                  data-testid="documents-import-button"
                >
                  <Upload className="h-4 w-4" aria-hidden="true" />
                  <span className="hidden sm:inline">{tCreate("import")}</span>
                </Button>
              </>
            ) : null}
            <Button asChild size="sm" variant="ghost">
              <Link href="/">
                <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
                <span className="hidden sm:inline">{t("backToWorkspace")}</span>
              </Link>
            </Button>
          </div>
        </header>
        <main className="min-h-[calc(100vh-3rem)]">
          <RealtimeProvider organizationId={organizationId} spaceId={spaceId}>
            {children}
          </RealtimeProvider>
        </main>
        {hasOrganization ? <CommandPalette /> : null}
        <DocumentImportDialog
          open={importOpen}
          organizationId={organizationId}
          spaceId={spaceId}
          onCreated={(documentId) => router.push(`/documents/${documentId}`)}
          onOpenChange={setImportOpen}
        />
        <DocumentPasteDialog
          open={pasteOpen}
          organizationId={organizationId}
          spaceId={spaceId}
          onCreated={(documentId) => router.push(`/documents/${documentId}`)}
          onOpenChange={setPasteOpen}
        />
      </div>
    </DocumentCreateProvider>
  );
}
