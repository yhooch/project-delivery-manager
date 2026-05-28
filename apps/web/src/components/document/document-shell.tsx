"use client";

import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  BookOpen,
  ChevronLeft,
  Loader2,
  PanelLeft,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { Link, usePathname, useRouter } from "../../i18n/routing";
import { getApiErrorMessageKey } from "../../lib/api-error-messages";
import {
  moveDocumentFolder,
  moveDocumentsToFolder,
  reorderDocumentFolders,
} from "../../lib/document-service";
import { RealtimeProvider } from "../../lib/realtime";
import { cn } from "../../lib/utils";
import { useSession } from "../providers/session-provider";
import { Button } from "../ui/button";
import { Sheet, SheetContent, SheetTitle } from "../ui/sheet";
import {
  CommandPalette,
  useCommandPaletteShortcut,
} from "../shell/command-palette";
import { DocumentCreateProvider } from "./document-create-context";
import { DocumentDirectoryProvider } from "./document-directory-context";
import {
  DOCUMENT_DIRECTORY_REFRESH_EVENT,
  DOCUMENT_FOLDER_MAX_DEPTH,
  DOCUMENT_LIST_REFRESH_EVENT,
  getDocumentDirectorySelection,
  type DocumentDragData,
  type DocumentDragDataPayload,
  type DocumentDropDataPayload,
  type DocumentFolderDragData,
} from "./document-directory-model";
import { DocumentDirectoryRail } from "./document-directory-rail";
import { DocumentImportDialog, DocumentPasteDialog } from "./documents-page";

type DocumentShellProps = {
  children: ReactNode;
};

const DIRECTORY_COLLAPSED_STORAGE_KEY = "documents.directory.collapsed";
const DOCUMENT_DETAIL_PATHNAME_PATTERN = /^\/documents\/[^/?#]+/u;

export function DocumentShell({ children }: DocumentShellProps) {
  const t = useTranslations("shell.documents");
  const tShell = useTranslations("shell");
  const tRoot = useTranslations();
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const {
    currentOrganization,
    currentSpace,
    initializeSession,
    session,
    sessionErrorKey,
    status,
  } = useSession();
  const hasOrganization = Boolean(currentOrganization);
  const isDocumentDetailRoute = DOCUMENT_DETAIL_PATHNAME_PATTERN.test(pathname);
  const showDocumentDirectory = hasOrganization && !isDocumentDetailRoute;
  const [importOpen, setImportOpen] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [directoryOpen, setDirectoryOpen] = useState(false);
  const [directoryCollapsed, setDirectoryCollapsed] = useState(false);
  const [activeDocumentFolderId, setActiveDocumentFolderId] = useState<
    string | null | undefined
  >(undefined);

  const createActions = useMemo(
    () => ({
      openImport: () => setImportOpen(true),
      openPaste: () => setPasteOpen(true),
    }),
    [],
  );

  useCommandPaletteShortcut({ enabled: hasOrganization });

  const directorySelection = useMemo(
    () =>
      getDocumentDirectorySelection(
        new URLSearchParams(searchParams.toString()),
      ),
    [searchParams],
  );
  const createFolderId =
    showDocumentDirectory && directorySelection.view === "folder"
      ? directorySelection.folderId
      : undefined;

  useEffect(() => {
    const stored = window.localStorage.getItem(DIRECTORY_COLLAPSED_STORAGE_KEY);
    setDirectoryCollapsed(stored === "true");
  }, []);

  useEffect(() => {
    window.localStorage.setItem(
      DIRECTORY_COLLAPSED_STORAGE_KEY,
      directoryCollapsed ? "true" : "false",
    );
  }, [directoryCollapsed]);

  useEffect(() => {
    if (isDocumentDetailRoute) {
      setDirectoryOpen(false);
    }
  }, [isDocumentDetailRoute]);

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

  const organizationId =
    currentOrganization?.id ?? session.defaultOrganizationId;
  const spaceId = currentSpace?.id ?? session.defaultSpaceId;

  return (
    <DocumentCreateProvider value={createActions}>
      <DocumentDirectoryProvider
        value={{ activeDocumentFolderId, setActiveDocumentFolderId }}
      >
        <div className="min-h-screen bg-background text-foreground">
          <header className="sticky top-0 z-30 flex h-12 items-center justify-between gap-2 border-b border-border bg-background/95 px-4 backdrop-blur md:px-6">
            <div className="flex min-w-0 items-center gap-2">
              {showDocumentDirectory ? (
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  className="lg:hidden"
                  aria-label={t("directory")}
                  onClick={() => setDirectoryOpen(true)}
                >
                  <PanelLeft className="h-4 w-4" aria-hidden="true" />
                </Button>
              ) : null}
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-foreground text-background">
                <BookOpen className="h-4 w-4" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold">
                  {t("title")}
                </div>
                <div className="hidden truncate text-[11px] text-muted-foreground sm:block">
                  {currentSpace?.name ?? t("noSpace")}
                </div>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Button asChild size="sm" variant="ghost">
                <Link href="/">
                  <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
                  <span className="hidden sm:inline">
                    {t("backToWorkspace")}
                  </span>
                </Link>
              </Button>
            </div>
          </header>
          <main className="min-h-[calc(100vh-3rem)]">
            <RealtimeProvider organizationId={organizationId} spaceId={spaceId}>
              <DocumentDragDropLayer
                enabled={showDocumentDirectory}
                organizationId={organizationId}
                spaceId={spaceId}
              >
                <div className="flex min-h-[calc(100vh-3rem)] min-w-0">
                  {showDocumentDirectory ? (
                    <DocumentDirectoryRail
                      collapsed={directoryCollapsed}
                      onCollapsedChange={setDirectoryCollapsed}
                      organizationId={organizationId}
                      spaceId={spaceId}
                    />
                  ) : null}
                  <section className="min-w-0 flex-1">{children}</section>
                  {showDocumentDirectory ? (
                    <Sheet open={directoryOpen} onOpenChange={setDirectoryOpen}>
                      <SheetContent
                        side="left"
                        className="w-[min(22rem,92vw)] p-0 sm:max-w-sm"
                        closeLabel={t("closeDirectory")}
                      >
                        <SheetTitle className="sr-only">
                          {t("directory")}
                        </SheetTitle>
                        <DocumentDirectoryRail
                          mobile
                          onNavigate={() => setDirectoryOpen(false)}
                          organizationId={organizationId}
                          spaceId={spaceId}
                        />
                      </SheetContent>
                    </Sheet>
                  ) : null}
                </div>
              </DocumentDragDropLayer>
            </RealtimeProvider>
          </main>
          {hasOrganization ? <CommandPalette /> : null}
          <DocumentImportDialog
            open={importOpen}
            folderId={createFolderId}
            organizationId={organizationId}
            spaceId={spaceId}
            onCreated={(documentId) => router.push(`/documents/${documentId}`)}
            onOpenChange={setImportOpen}
          />
          <DocumentPasteDialog
            open={pasteOpen}
            folderId={createFolderId}
            organizationId={organizationId}
            spaceId={spaceId}
            onCreated={(documentId) => router.push(`/documents/${documentId}`)}
            onOpenChange={setPasteOpen}
          />
        </div>
      </DocumentDirectoryProvider>
    </DocumentCreateProvider>
  );
}

function DocumentDragDropLayer({
  children,
  enabled,
  organizationId,
  spaceId,
}: {
  children: ReactNode;
  enabled: boolean;
  organizationId?: string;
  spaceId?: string;
}) {
  const t = useTranslations("documents.directory.drag");
  const tRoot = useTranslations();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );
  const [activeDrag, setActiveDrag] = useState<DocumentDragDataPayload | null>(
    null,
  );
  const [dragError, setDragError] = useState<string | null>(null);

  useEffect(() => {
    if (!dragError) {
      return;
    }

    const timer = window.setTimeout(() => setDragError(null), 5000);
    return () => window.clearTimeout(timer);
  }, [dragError]);

  const dispatchRefresh = useCallback((clearDocumentSelection: boolean) => {
    window.dispatchEvent(new CustomEvent(DOCUMENT_DIRECTORY_REFRESH_EVENT));
    window.dispatchEvent(
      new CustomEvent(DOCUMENT_LIST_REFRESH_EVENT, {
        detail: { clearDocumentSelection },
      }),
    );
  }, []);

  const handleDocumentDrop = useCallback(
    async (drag: DocumentDragData, drop: DocumentDropDataPayload) => {
      if (!spaceId || drop.type !== "document-folder-drop") {
        return;
      }

      const documentsToMove = drag.documents.filter(
        (document) => document.folderId !== drop.folderId,
      );
      if (documentsToMove.length === 0) {
        return;
      }

      await moveDocumentsToFolder({
        documentIds: documentsToMove.map((document) => document.id),
        folderId: drop.folderId,
        organizationId,
        spaceId,
      });
      dispatchRefresh(true);
    },
    [dispatchRefresh, organizationId, spaceId],
  );

  const handleFolderDrop = useCallback(
    async (drag: DocumentFolderDragData, drop: DocumentDropDataPayload) => {
      if (!spaceId) {
        return;
      }

      if (drop.type === "document-folder-root") {
        if (drag.parentId === null) {
          return;
        }
        await moveDocumentFolder({
          folderId: drag.folderId,
          organizationId,
          parentId: null,
          spaceId,
          version: drag.version,
        });
        dispatchRefresh(false);
        return;
      }

      if (drop.type === "document-folder-position") {
        if (drag.parentId !== drop.parentId) {
          return;
        }
        const orderedFolderIds = reorderFolderIds(
          drop.siblingIds,
          drag.folderId,
          drop.folderId,
          drop.position,
        );
        if (areStringArraysEqual(orderedFolderIds, drop.siblingIds)) {
          return;
        }
        await reorderDocumentFolders({
          orderedFolderIds,
          organizationId,
          parentId: drop.parentId,
          spaceId,
        });
        dispatchRefresh(false);
        return;
      }

      if (drop.folderId === drag.folderId) {
        return;
      }
      if (drop.ancestorIds.includes(drag.folderId)) {
        setDragError(t("invalidTarget"));
        return;
      }
      if (
        drop.depth + 1 + drag.maxDescendantRelativeDepth >
        DOCUMENT_FOLDER_MAX_DEPTH
      ) {
        setDragError(t("depthExceeded"));
        return;
      }
      if (drag.parentId === drop.folderId) {
        return;
      }

      await moveDocumentFolder({
        folderId: drag.folderId,
        organizationId,
        parentId: drop.folderId,
        spaceId,
        version: drag.version,
      });
      dispatchRefresh(false);
    },
    [dispatchRefresh, organizationId, spaceId, t],
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveDrag(readDragData(event.active.data.current));
    setDragError(null);
  }, []);

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const drag = readDragData(event.active.data.current);
      const drop = readDropData(event.over?.data.current);
      setActiveDrag(null);

      if (!drag || !drop) {
        return;
      }

      try {
        if (drag.type === "document") {
          await handleDocumentDrop(drag, drop);
        } else {
          await handleFolderDrop(drag, drop);
        }
      } catch (error) {
        setDragError(
          t("moveFailed", { message: tRoot(getApiErrorMessageKey(error)) }),
        );
      }
    },
    [handleDocumentDrop, handleFolderDrop, t, tRoot],
  );

  if (!enabled) {
    return <>{children}</>;
  }

  return (
    <DndContext
      collisionDetection={pointerWithin}
      sensors={sensors}
      onDragCancel={() => setActiveDrag(null)}
      onDragEnd={(event) => void handleDragEnd(event)}
      onDragStart={handleDragStart}
    >
      {children}
      {dragError ? (
        <div
          className="fixed bottom-4 right-4 z-50 max-w-sm rounded-md border border-destructive/30 bg-background px-3 py-2 text-sm text-destructive shadow-lg"
          role="alert"
        >
          {dragError}
        </div>
      ) : null}
      <DragOverlay>
        {activeDrag ? <DocumentDragOverlay drag={activeDrag} /> : null}
      </DragOverlay>
    </DndContext>
  );
}

function DocumentDragOverlay({ drag }: { drag: DocumentDragDataPayload }) {
  const t = useTranslations("documents.directory.drag");

  return (
    <div
      className={cn(
        "max-w-64 truncate rounded-md border border-border bg-background px-3 py-2 text-xs font-medium text-foreground shadow-lg",
      )}
    >
      {drag.type === "document"
        ? t("documentsOverlay", { count: drag.documents.length })
        : t("folderOverlay", { name: drag.name })}
    </div>
  );
}

function readDragData(value: unknown): DocumentDragDataPayload | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const data = value as Partial<DocumentDragDataPayload>;
  return data.type === "document" || data.type === "document-folder"
    ? (data as DocumentDragDataPayload)
    : null;
}

function readDropData(value: unknown): DocumentDropDataPayload | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const data = value as Partial<DocumentDropDataPayload>;
  return data.type === "document-folder-drop" ||
    data.type === "document-folder-position" ||
    data.type === "document-folder-root"
    ? (data as DocumentDropDataPayload)
    : null;
}

function reorderFolderIds(
  siblingIds: string[],
  activeId: string,
  targetId: string,
  position: "after" | "before",
) {
  if (!siblingIds.includes(activeId) || !siblingIds.includes(targetId)) {
    return siblingIds;
  }

  const withoutActive = siblingIds.filter((id) => id !== activeId);
  const targetIndex = withoutActive.indexOf(targetId);
  if (targetIndex < 0) {
    return siblingIds;
  }

  const insertIndex = position === "after" ? targetIndex + 1 : targetIndex;
  return [
    ...withoutActive.slice(0, insertIndex),
    activeId,
    ...withoutActive.slice(insertIndex),
  ];
}

function areStringArraysEqual(left: string[], right: string[]) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}
