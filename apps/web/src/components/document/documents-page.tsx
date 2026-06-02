"use client";

import { useDraggable } from "@dnd-kit/core";
import {
  AlignJustify,
  Archive,
  Bot,
  FilePlus2,
  FileText,
  Folder,
  GripVertical,
  ListChecks,
  List,
  Loader2,
  Search,
  Upload,
  User,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";

import { Link, useRouter } from "../../i18n/routing";
import { getApiErrorMessageKey } from "../../lib/api-error-messages";
import type {
  DocumentFilterKey,
  DocumentFolder,
  DocumentSortBy,
  DocumentStatus,
  DocumentSummary,
} from "../../lib/document-service";
import {
  importDocxDocument,
  importMarkdownDocument,
  listDocumentFolders,
  listDocuments,
  pasteDocument,
} from "../../lib/document-service";
import {
  createDocumentPasteForm,
  getImportKind,
  normalizeDocumentTitle,
  type DocumentPasteForm,
} from "../../lib/document-forms";
import {
  formatDocumentRelativeTimestamp,
  getDocumentActorKey,
  getDocumentDisplayCode,
  getDocumentFilterKeys,
  getDocumentLinkDisplayCode,
  getDocumentLinkHref,
  getDocumentSourceKey,
  isRequirementDocumentLink,
  isRequirementDocument,
} from "../../lib/document-view-model";
import { useRealtimeInvalidation } from "../../lib/realtime";
import { cn } from "../../lib/utils";
import { useDocumentCreate } from "./document-create-context";
import {
  DOCUMENT_DIRECTORY_REFRESH_EVENT,
  DOCUMENT_LIST_REFRESH_EVENT,
  createDocumentDirectoryHref,
  findFolderNode,
  getDocumentDirectorySelection,
  getDocumentFilterForDirectoryView,
  normalizeDocumentFolderTree,
  type DocumentDragDataPayload,
  type DocumentDirectoryView,
} from "./document-directory-model";
import { useSession } from "../providers/session-provider";
import { TagBadgeList } from "../tag";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { SelectMenu } from "../ui/select-menu";
import { Textarea } from "../ui/textarea";

const PAGE_SIZE = 50;
const DOCUMENTS_REALTIME_KEYS = [
  "document-list",
  "resource-documents",
] as const;
const DOCUMENT_CHILD_FOLDER_REALTIME_KEYS = ["document-directory"] as const;
const DENSITY_STORAGE_KEY = "documents.list.density";
export const DOCUMENTS_LAST_LIST_HREF_STORAGE_KEY = "documents.lastListHref";

const SORT_OPTIONS = {
  recentEdited: {
    dateField: "lastEditedAt",
    sortBy: "lastEditedAt",
    sortOrder: "desc",
  },
  recentCreated: {
    dateField: "createdAt",
    sortBy: "createdAt",
    sortOrder: "desc",
  },
  title: { dateField: null, sortBy: "title", sortOrder: "asc" },
} as const satisfies Record<
  string,
  {
    dateField: "lastEditedAt" | "createdAt" | null;
    sortBy: DocumentSortBy;
    sortOrder: "asc" | "desc";
  }
>;

type DocumentSortKey = keyof typeof SORT_OPTIONS;
type DocumentDensity = "comfortable" | "compact";

type DocumentTranslator = (
  key: string,
  values?: Record<string, number | string>,
) => string;

export function DocumentsPage() {
  const t = useTranslations("documents");
  const tRoot = useTranslations();
  const locale = useLocale();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { currentOrganization, currentSpace, session, status } = useSession();
  const organizationId =
    currentOrganization?.id ?? session?.defaultOrganizationId;
  const spaceId = currentSpace?.id ?? session?.defaultSpaceId;
  const searchParamsString = searchParams.toString();
  const [items, setItems] = useState<DocumentSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [folders, setFolders] = useState<DocumentFolder[]>([]);
  const [isLoadingFolders, setIsLoadingFolders] = useState(false);
  const [folderErrorKey, setFolderErrorKey] = useState<string | null>(null);
  const [sort, setSort] = useState<DocumentSortKey>("recentEdited");
  const [density, setDensity] = useState<DocumentDensity>("comfortable");
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedDocumentIds, setSelectedDocumentIds] = useState<Set<string>>(
    () => new Set(),
  );
  const directorySelection = useMemo(
    () =>
      getDocumentDirectorySelection(new URLSearchParams(searchParamsString)),
    [searchParamsString],
  );
  const currentListHref = useMemo(
    () =>
      searchParamsString ? `/documents?${searchParamsString}` : "/documents",
    [searchParamsString],
  );
  const filter = getDocumentFilterForDirectoryView(directorySelection.view);
  const selectedDocuments = useMemo(
    () => items.filter((item) => selectedDocumentIds.has(item.id)),
    [items, selectedDocumentIds],
  );
  const hasActiveSearch =
    query.trim().length > 0 || debouncedQuery.trim().length > 0;
  const shouldShowChildFolders =
    directorySelection.view === "folder" &&
    Boolean(directorySelection.folderId) &&
    !hasActiveSearch;
  const folderTree = useMemo(
    () => normalizeDocumentFolderTree(folders),
    [folders],
  );
  const childFolders = useMemo(() => {
    if (!shouldShowChildFolders || !directorySelection.folderId) {
      return [];
    }

    return (
      findFolderNode(folderTree, directorySelection.folderId)?.children ?? []
    );
  }, [directorySelection.folderId, folderTree, shouldShowChildFolders]);
  const hasChildFolders = childFolders.length > 0;
  const { openImport, openPaste } = useDocumentCreate();

  useEffect(() => {
    const stored = window.localStorage.getItem(DENSITY_STORAGE_KEY);
    if (stored === "comfortable" || stored === "compact") {
      setDensity(stored);
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(DENSITY_STORAGE_KEY, density);
  }, [density]);

  useEffect(() => {
    window.sessionStorage.setItem(
      DOCUMENTS_LAST_LIST_HREF_STORAGE_KEY,
      currentListHref,
    );
  }, [currentListHref]);

  const loadDocuments = useCallback(
    async (options?: { realtime?: boolean }) => {
      if (!spaceId) {
        setItems([]);
        return;
      }

      const isRealtime = options?.realtime === true;
      if (!isRealtime) {
        setIsLoading(true);
        setErrorKey(null);
      }
      try {
        const result = await listDocuments({
          currentUserId: session?.user?.id,
          filter,
          folderId: directorySelection.folderId,
          includeDescendants: directorySelection.includeDescendants,
          organizationId,
          page: 1,
          pageSize: PAGE_SIZE,
          query: debouncedQuery,
          sortBy: SORT_OPTIONS[sort].sortBy,
          sortOrder: SORT_OPTIONS[sort].sortOrder,
          spaceId,
          unfiled: directorySelection.view === "unfiled",
        });
        setItems(result.items);
        setTotal(result.total);
        setPage(1);
      } catch (error) {
        if (!isRealtime) {
          setErrorKey(getApiErrorMessageKey(error));
          setItems([]);
          setTotal(0);
        }
      } finally {
        if (!isRealtime) {
          setIsLoading(false);
        }
      }
    },
    [
      debouncedQuery,
      directorySelection.folderId,
      directorySelection.includeDescendants,
      directorySelection.view,
      filter,
      organizationId,
      session?.user?.id,
      sort,
      spaceId,
    ],
  );

  const loadChildFolders = useCallback(
    async (options?: { realtime?: boolean }) => {
      if (!spaceId || !shouldShowChildFolders) {
        setFolders([]);
        setFolderErrorKey(null);
        setIsLoadingFolders(false);
        return;
      }

      const isRealtime = options?.realtime === true;
      if (!isRealtime) {
        setIsLoadingFolders(true);
        setFolderErrorKey(null);
      }

      try {
        const next = await listDocumentFolders({ organizationId, spaceId });
        setFolders(next);
      } catch (error) {
        if (!isRealtime) {
          setFolderErrorKey(getApiErrorMessageKey(error));
          setFolders([]);
        }
      } finally {
        if (!isRealtime) {
          setIsLoadingFolders(false);
        }
      }
    },
    [organizationId, shouldShowChildFolders, spaceId],
  );

  const loadMore = useCallback(async () => {
    if (!spaceId || isLoadingMore) {
      return;
    }

    const nextPage = page + 1;
    setIsLoadingMore(true);
    try {
      const result = await listDocuments({
        currentUserId: session?.user?.id,
        filter,
        folderId: directorySelection.folderId,
        includeDescendants: directorySelection.includeDescendants,
        organizationId,
        page: nextPage,
        pageSize: PAGE_SIZE,
        query: debouncedQuery,
        sortBy: SORT_OPTIONS[sort].sortBy,
        sortOrder: SORT_OPTIONS[sort].sortOrder,
        spaceId,
        unfiled: directorySelection.view === "unfiled",
      });
      setItems((current) => [...current, ...result.items]);
      setTotal(result.total);
      setPage(nextPage);
    } catch (error) {
      setErrorKey(getApiErrorMessageKey(error));
    } finally {
      setIsLoadingMore(false);
    }
  }, [
    debouncedQuery,
    directorySelection.folderId,
    directorySelection.includeDescendants,
    directorySelection.view,
    filter,
    isLoadingMore,
    organizationId,
    page,
    session?.user?.id,
    sort,
    spaceId,
  ]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(query.trim());
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    if (status !== "authenticated") {
      return;
    }
    void loadDocuments();
  }, [loadDocuments, status]);

  useEffect(() => {
    if (status !== "authenticated") {
      return;
    }
    void loadChildFolders();
  }, [loadChildFolders, status]);

  useRealtimeInvalidation(DOCUMENTS_REALTIME_KEYS, () => {
    if (status !== "authenticated") {
      return;
    }
    void loadDocuments({ realtime: true });
  });

  useRealtimeInvalidation(DOCUMENT_CHILD_FOLDER_REALTIME_KEYS, () => {
    if (status !== "authenticated") {
      return;
    }
    void loadChildFolders({ realtime: true });
  });

  useEffect(() => {
    const handleDragRefresh = (event: Event) => {
      const detail = (
        event as CustomEvent<{ clearDocumentSelection?: boolean }>
      ).detail;
      if (detail?.clearDocumentSelection) {
        setSelectedDocumentIds(new Set());
      }
      if (status !== "authenticated") {
        return;
      }
      void loadDocuments({ realtime: true });
    };

    window.addEventListener(DOCUMENT_LIST_REFRESH_EVENT, handleDragRefresh);
    return () =>
      window.removeEventListener(
        DOCUMENT_LIST_REFRESH_EVENT,
        handleDragRefresh,
      );
  }, [loadDocuments, status]);

  useEffect(() => {
    const handleDirectoryRefresh = () => {
      if (status !== "authenticated") {
        return;
      }
      void loadChildFolders({ realtime: true });
    };

    window.addEventListener(
      DOCUMENT_DIRECTORY_REFRESH_EVENT,
      handleDirectoryRefresh,
    );
    return () =>
      window.removeEventListener(
        DOCUMENT_DIRECTORY_REFRESH_EVENT,
        handleDirectoryRefresh,
      );
  }, [loadChildFolders, status]);

  useEffect(() => {
    const visibleIds = new Set(items.map((item) => item.id));
    setSelectedDocumentIds((current) => {
      const next = new Set(
        [...current].filter((documentId) => visibleIds.has(documentId)),
      );
      return next.size === current.size ? current : next;
    });
  }, [items]);

  const updateFilter = useCallback(
    (key: DocumentFilterKey) => {
      const view = getDirectoryViewForFilter(key);
      router.replace(createDocumentDirectoryHref({ view }) as never, {
        scroll: false,
      });
    },
    [router],
  );

  const toggleDocumentSelection = useCallback((documentId: string) => {
    setSelectedDocumentIds((current) => {
      const next = new Set(current);
      if (next.has(documentId)) {
        next.delete(documentId);
      } else {
        next.add(documentId);
      }
      return next;
    });
  }, []);

  const clearDocumentSelection = useCallback(() => {
    setSelectedDocumentIds(new Set());
  }, []);

  const toggleSelectionMode = useCallback(() => {
    if (isSelectionMode) {
      setSelectedDocumentIds(new Set());
    }
    setIsSelectionMode(!isSelectionMode);
  }, [isSelectionMode]);

  const openChildFolder = useCallback(
    (folderId: string) => {
      router.push(
        createDocumentDirectoryHref({
          folderId,
          includeDescendants: directorySelection.includeDescendants,
          view: "folder",
        }) as never,
      );
    },
    [directorySelection.includeDescendants, router],
  );

  const showEmpty =
    !isLoading &&
    !isLoadingFolders &&
    !errorKey &&
    !folderErrorKey &&
    !hasChildFolders &&
    items.length === 0;
  const filterKeys = getDocumentFilterKeys();

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 py-5 md:px-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="sr-only">{currentSpace?.name ?? t("unknownSpace")}</h1>
          <p className="text-sm font-medium text-foreground">
            {currentSpace?.name ?? t("unknownSpace")}
          </p>
          <p className="mt-0.5 max-w-xl text-xs text-muted-foreground">
            {t("home.subtitle")}
          </p>
        </div>
        <div
          className="flex shrink-0 items-center gap-2"
          data-testid="documents-create-actions"
        >
          <Button
            type="button"
            size="sm"
            variant="outline"
            aria-label={t("home.paste")}
            onClick={openPaste}
            data-testid="documents-paste-button"
          >
            <FilePlus2 className="h-4 w-4" aria-hidden="true" />
            {t("home.paste")}
          </Button>
          <Button
            type="button"
            size="sm"
            aria-label={t("home.import")}
            onClick={openImport}
            data-testid="documents-import-button"
          >
            <Upload className="h-4 w-4" aria-hidden="true" />
            {t("home.import")}
          </Button>
        </div>
      </header>

      <div
        className="relative -mx-1 flex gap-1 overflow-x-auto px-1"
        role="tablist"
        aria-label={t("home.filtersLabel")}
      >
        {filterKeys.map((key) => {
          const active = filter === key;
          return (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={active}
              className={cn(
                "relative inline-flex h-9 shrink-0 items-center gap-1.5 rounded-none border-b-2 px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                active
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
              data-testid={`documents-filter-${key.replace(/[A-Z]/gu, (m) => `-${m.toLowerCase()}`)}`}
              onClick={() => updateFilter(key)}
            >
              {t(`filters.${key}`)}
            </button>
          );
        })}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-0 border-b border-border/60"
        />
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-2">
        <label className="relative min-w-0 flex-1">
          <span className="sr-only">{t("home.searchLabel")}</span>
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            className="h-9 pl-9"
            data-testid="documents-search-input"
            placeholder={t("home.searchPlaceholder")}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <div className="flex shrink-0 items-center gap-2">
          <SelectMenu
            aria-label={t("home.sortLabel")}
            className="h-9 w-36"
            data-testid="documents-sort-select"
            value={sort}
            onChange={(event) => setSort(event.target.value as DocumentSortKey)}
          >
            {(Object.keys(SORT_OPTIONS) as DocumentSortKey[]).map((key) => (
              <option key={key} value={key}>
                {t(`sort.${key}`)}
              </option>
            ))}
          </SelectMenu>
          <div
            className="flex h-9 shrink-0 items-center rounded-md bg-muted/50 p-0.5"
            role="group"
            aria-label={t("home.densityLabel")}
          >
            {(["comfortable", "compact"] as DocumentDensity[]).map((value) => {
              const Icon = value === "comfortable" ? List : AlignJustify;
              return (
                <button
                  key={value}
                  type="button"
                  aria-pressed={density === value}
                  aria-label={t(`density.${value}`)}
                  title={t(`density.${value}`)}
                  className={cn(
                    "flex h-8 w-8 items-center justify-center rounded transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    density === value
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                  data-testid={`documents-density-${value}`}
                  onClick={() => setDensity(value)}
                >
                  <Icon className="h-4 w-4" aria-hidden="true" />
                </button>
              );
            })}
          </div>
          <Button
            type="button"
            size="default"
            variant={isSelectionMode ? "secondary" : "outline"}
            aria-pressed={isSelectionMode}
            aria-label={
              isSelectionMode ? t("selection.done") : t("selection.select")
            }
            title={
              isSelectionMode ? t("selection.done") : t("selection.select")
            }
            data-testid="documents-selection-mode-toggle"
            onClick={toggleSelectionMode}
          >
            <ListChecks className="h-4 w-4" aria-hidden="true" />
            {isSelectionMode ? t("selection.done") : t("selection.select")}
          </Button>
        </div>
      </div>

      {selectedDocumentIds.size > 0 ? (
        <div
          className="sticky top-12 z-20 flex h-10 items-center justify-between gap-2 rounded-md bg-primary/10 px-3 text-xs font-medium text-foreground shadow-sm"
          data-testid="documents-selection-toolbar"
        >
          <span>
            {t("selection.count", { count: selectedDocumentIds.size })}
          </span>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={clearDocumentSelection}
          >
            {t("selection.clear")}
          </Button>
        </div>
      ) : null}

      {errorKey ? (
        <div
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
          data-testid="documents-error"
        >
          {tRoot(errorKey)}
        </div>
      ) : null}

      {shouldShowChildFolders && folderErrorKey ? (
        <div
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
          data-testid="documents-child-folders-error"
        >
          {tRoot(folderErrorKey)}
        </div>
      ) : null}

      {isLoading ? (
        <div className="flex min-h-64 items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          {t("home.loading")}
        </div>
      ) : null}

      {shouldShowChildFolders && isLoadingFolders && !isLoading ? (
        <div
          className="flex h-11 items-center gap-2 px-1 text-sm text-muted-foreground"
          data-testid="documents-child-folders-loading"
        >
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          {t("directory.loadingChildFolders")}
        </div>
      ) : null}

      {hasChildFolders ? (
        <DocumentChildFolderList
          density={density}
          folders={childFolders}
          onOpenFolder={openChildFolder}
        />
      ) : null}

      {showEmpty ? <DocumentsEmptyState /> : null}

      {!isLoading && items.length > 0 ? (
        <DocumentList
          dateField={SORT_OPTIONS[sort].dateField}
          density={density}
          items={items}
          locale={locale}
          selectionMode={isSelectionMode}
          selectedDocumentIds={selectedDocumentIds}
          selectedDocuments={selectedDocuments}
          onToggleDocumentSelection={toggleDocumentSelection}
        />
      ) : null}

      {!isLoading && items.length > 0 && items.length < total ? (
        <div className="flex justify-center pt-1">
          <Button
            type="button"
            variant="outline"
            disabled={isLoadingMore}
            onClick={() => void loadMore()}
            data-testid="documents-load-more"
          >
            {isLoadingMore ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : null}
            {t("home.loadMore", { count: total - items.length })}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function DocumentChildFolderList({
  density,
  folders,
  onOpenFolder,
}: {
  density: DocumentDensity;
  folders: DocumentFolder[];
  onOpenFolder: (folderId: string) => void;
}) {
  const t = useTranslations("documents");
  const isCompact = density === "compact";

  return (
    <section
      className="flex flex-col gap-1.5"
      data-testid="documents-child-folders"
    >
      <header className="flex items-baseline gap-2 px-1">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {t("directory.childFolders")}
        </h2>
        <span className="text-[11px] tabular-nums text-muted-foreground/70">
          {folders.length}
        </span>
      </header>
      <ul className={cn("grid", isCompact ? "gap-0.5" : "gap-1")}>
        {folders.map((folder) => (
          <li key={folder.id}>
            <button
              type="button"
              aria-label={t("directory.openFolder", { name: folder.name })}
              className={cn(
                "group flex w-full min-w-0 cursor-pointer items-center rounded-md text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                isCompact
                  ? "min-h-8 gap-1.5 px-1.5 py-1"
                  : "min-h-11 gap-2 px-2 py-1.5",
              )}
              data-testid="documents-child-folder"
              onClick={() => onOpenFolder(folder.id)}
            >
              <span
                className={cn(
                  "flex shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary",
                  isCompact ? "h-6 w-6" : "h-8 w-8",
                )}
              >
                <Folder
                  className={cn(isCompact ? "h-3.5 w-3.5" : "h-4 w-4")}
                  aria-hidden="true"
                />
              </span>
              <span
                className={cn(
                  "min-w-0 flex-1 truncate font-medium text-foreground",
                  isCompact ? "text-[13px]" : "text-sm",
                )}
              >
                {folder.name}
              </span>
              <span
                className={cn(
                  "shrink-0 rounded bg-muted/60 tabular-nums text-muted-foreground",
                  isCompact
                    ? "px-1 py-0 text-[10px]"
                    : "px-1.5 py-0.5 text-[11px]",
                )}
              >
                {t("directory.folderDocumentCount", {
                  count: folder.documentCount,
                })}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function getDirectoryViewForFilter(
  filter: DocumentFilterKey,
): DocumentDirectoryView {
  if (filter === "createdByMe") {
    return "createdByMe";
  }
  if (filter === "archived") {
    return "archived";
  }
  if (filter === "mcpCreated") {
    return "mcpCreated";
  }
  if (filter === "recentMcpEdited") {
    return "recentMcpEdited";
  }
  return "all";
}

type DocumentGroupKey = "today" | "thisWeek" | "thisMonth" | "earlier";

function getDateBucket(iso: string): DocumentGroupKey {
  const date = new Date(iso);
  const now = new Date();
  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  );
  if (date >= startOfToday) {
    return "today";
  }
  const weekAgo = new Date(startOfToday);
  weekAgo.setDate(weekAgo.getDate() - 7);
  if (date >= weekAgo) {
    return "thisWeek";
  }
  const monthAgo = new Date(startOfToday);
  monthAgo.setMonth(monthAgo.getMonth() - 1);
  if (date >= monthAgo) {
    return "thisMonth";
  }
  return "earlier";
}

function groupDocumentsByDate(
  items: DocumentSummary[],
  dateField: "lastEditedAt" | "createdAt" | null,
): { items: DocumentSummary[]; key: DocumentGroupKey | "all" }[] {
  if (!dateField) {
    return [{ items, key: "all" }];
  }
  const order: DocumentGroupKey[] = [
    "today",
    "thisWeek",
    "thisMonth",
    "earlier",
  ];
  const buckets = new Map<DocumentGroupKey, DocumentSummary[]>();
  for (const item of items) {
    const value =
      dateField === "createdAt" ? item.createdAt : item.lastEditedAt;
    const bucket = getDateBucket(value);
    const list = buckets.get(bucket) ?? [];
    list.push(item);
    buckets.set(bucket, list);
  }
  return order
    .filter((key) => buckets.has(key))
    .map((key) => ({ items: buckets.get(key) ?? [], key }));
}

function DocumentList({
  dateField,
  density,
  items,
  locale,
  onToggleDocumentSelection,
  selectionMode,
  selectedDocumentIds,
  selectedDocuments,
}: {
  dateField: "lastEditedAt" | "createdAt" | null;
  density: DocumentDensity;
  items: DocumentSummary[];
  locale: string;
  onToggleDocumentSelection: (documentId: string) => void;
  selectionMode: boolean;
  selectedDocumentIds: Set<string>;
  selectedDocuments: DocumentSummary[];
}) {
  const t = useTranslations("documents");
  const groups = groupDocumentsByDate(items, dateField);

  return (
    <div className="flex flex-col gap-5" data-testid="documents-list">
      {groups.map((group) => (
        <section key={group.key} className="flex flex-col gap-1.5">
          {group.key !== "all" ? (
            <header
              className="flex items-baseline gap-2 px-1"
              data-testid={`documents-group-${group.key}`}
            >
              <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {t(`group.${group.key}`)}
              </h2>
              <span className="text-[11px] tabular-nums text-muted-foreground/70">
                {group.items.length}
              </span>
            </header>
          ) : null}
          <ul>
            {group.items.map((document) => (
              <li key={document.id}>
                <DocumentRow
                  density={density}
                  document={document}
                  locale={locale}
                  onToggleSelection={onToggleDocumentSelection}
                  selectionMode={selectionMode}
                  selected={selectedDocumentIds.has(document.id)}
                  selectedDocuments={selectedDocuments}
                />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function DocumentRow({
  density,
  document,
  locale,
  onToggleSelection,
  selectionMode,
  selected,
  selectedDocuments,
}: {
  density: DocumentDensity;
  document: DocumentSummary;
  locale: string;
  onToggleSelection: (documentId: string) => void;
  selectionMode: boolean;
  selected: boolean;
  selectedDocuments: DocumentSummary[];
}) {
  const t = useTranslations("documents");
  const isAi =
    document.sourceType === "MCP_CREATED" ||
    document.lastEditedVia === "MCP_CLIENT";
  const isRequirement = isRequirementDocument(document);
  const displayCode = getDocumentDisplayCode(document);
  const SourceIcon = isRequirement ? ListChecks : isAi ? Bot : User;
  const isArchived = document.status === "ARCHIVED";
  const isCompact = density === "compact";
  const revisionLabel = t("list.revision", { revision: document.revision });
  const dragDocuments =
    selectionMode && selected && selectedDocuments.length > 0
      ? selectedDocuments
      : [document];
  const draggable = useDraggable({
    id: `document:${document.id}`,
    data: {
      documents: dragDocuments.map((item) => ({
        folderId: item.folderId ?? null,
        id: item.id,
        revision: item.revision,
        title: item.title,
      })),
      type: "document",
    } satisfies DocumentDragDataPayload,
  });

  if (isCompact) {
    return (
      <div
        ref={draggable.setNodeRef}
        className={cn(
          "group flex min-w-0 items-center gap-1.5 rounded-md py-1 pl-1 pr-1.5 transition-colors",
          selected ? "bg-primary/10 hover:bg-primary/15" : "hover:bg-muted/50",
          draggable.isDragging && "opacity-50",
        )}
        data-testid="documents-list-item"
        {...draggable.listeners}
      >
        {selectionMode ? (
          <input
            type="checkbox"
            aria-label={t("list.selectDocument", {
              title: document.title || t("untitled"),
            })}
            checked={selected}
            className="h-3.5 w-3.5 shrink-0 rounded border-border text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            data-testid="documents-list-select"
            onChange={() => onToggleSelection(document.id)}
          />
        ) : null}

        <Button
          aria-label={
            selectionMode && selected && selectedDocuments.length > 1
              ? t("list.dragSelected", { count: selectedDocuments.length })
              : t("list.dragDocument", {
                  title: document.title || t("untitled"),
                })
          }
          className="h-5 w-4 shrink-0 cursor-grab text-muted-foreground opacity-0 transition-opacity active:cursor-grabbing group-focus-within:opacity-100 group-hover:opacity-100"
          data-testid="documents-list-drag-handle"
          size="icon-sm"
          type="button"
          variant="ghost"
          ref={draggable.setActivatorNodeRef}
          style={{ touchAction: "none" }}
          {...draggable.attributes}
          {...draggable.listeners}
        >
          <GripVertical className="h-3.5 w-3.5" aria-hidden="true" />
        </Button>

        <SourceIcon
          className={cn(
            "h-3.5 w-3.5 shrink-0",
            isArchived
              ? "text-muted-foreground/70"
              : isRequirement
                ? "text-primary"
                : isAi
                  ? "text-info"
                  : "text-muted-foreground",
          )}
          aria-hidden="true"
        />

        <Link
          href={`/documents/${document.id}`}
          draggable={false}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          data-testid="documents-list-item-link"
        >
          <span
            className={cn(
              "min-w-0 flex-1 truncate text-sm",
              isArchived ? "text-muted-foreground" : "text-foreground",
            )}
          >
            {document.title || t("untitled")}
          </span>
          {isRequirement ? (
            <RequirementDocumentBadge
              displayCode={displayCode}
              status={document.status}
            />
          ) : null}
          {isArchived ? (
            <Archive
              className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
              aria-label={t("status.ARCHIVED")}
            />
          ) : null}
          <DocumentRowLinks links={document.links ?? []} />
          <span
            className="shrink-0 rounded bg-muted/60 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
            title={revisionLabel}
          >
            v{document.revision}
          </span>
        </Link>
      </div>
    );
  }

  return (
    <div
      ref={draggable.setNodeRef}
      className={cn(
        "group flex min-w-0 items-start gap-2 rounded-lg py-2.5 pl-1.5 pr-2 transition-colors",
        selected ? "bg-primary/10 hover:bg-primary/15" : "hover:bg-muted/50",
        draggable.isDragging && "opacity-50",
      )}
      data-testid="documents-list-item"
      {...draggable.listeners}
    >
      {selectionMode ? (
        <input
          type="checkbox"
          aria-label={t("list.selectDocument", {
            title: document.title || t("untitled"),
          })}
          checked={selected}
          className="mt-1.5 h-4 w-4 shrink-0 rounded border-border text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          data-testid="documents-list-select"
          onChange={() => onToggleSelection(document.id)}
        />
      ) : null}

      <Button
        aria-label={
          selectionMode && selected && selectedDocuments.length > 1
            ? t("list.dragSelected", { count: selectedDocuments.length })
            : t("list.dragDocument", { title: document.title || t("untitled") })
        }
        className="mt-0.5 h-7 w-5 shrink-0 cursor-grab text-muted-foreground opacity-0 transition-opacity active:cursor-grabbing group-focus-within:opacity-100 group-hover:opacity-100"
        data-testid="documents-list-drag-handle"
        size="icon-sm"
        type="button"
        variant="ghost"
        ref={draggable.setActivatorNodeRef}
        style={{ touchAction: "none" }}
        {...draggable.attributes}
        {...draggable.listeners}
      >
        <GripVertical className="h-4 w-4" aria-hidden="true" />
      </Button>

      <div
        className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-md",
          isArchived
            ? "bg-muted text-muted-foreground/70"
            : isRequirement
              ? "bg-primary/10 text-primary"
              : isAi
                ? "bg-info/10 text-info"
                : "bg-muted text-foreground",
        )}
        aria-hidden="true"
      >
        <SourceIcon className="h-4 w-4" />
      </div>

      <Link
        href={`/documents/${document.id}`}
        draggable={false}
        className="min-w-0 flex-1 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        data-testid="documents-list-item-link"
      >
        <div className="flex min-w-0 items-center gap-2">
          {isRequirement ? (
            <RequirementDocumentBadge
              displayCode={displayCode}
              status={document.status}
            />
          ) : null}
          <span
            className={cn(
              "truncate text-[15px] font-semibold leading-snug text-foreground",
              isArchived && "text-muted-foreground",
            )}
          >
            {document.title || t("untitled")}
          </span>
          {isArchived ? (
            <span
              className="inline-flex shrink-0 items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
              title={t("status.ARCHIVED")}
            >
              <Archive className="h-3 w-3" aria-hidden="true" />
              {t("status.ARCHIVED")}
            </span>
          ) : null}
          <span
            className="ml-auto shrink-0 rounded bg-muted/60 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
            title={revisionLabel}
          >
            v{document.revision}
          </span>
        </div>
        <div className="mt-1 min-w-0 text-xs text-muted-foreground">
          <span className="block truncate">
            {formatDocumentCreatedMeta(document, locale, t)}
          </span>
        </div>
        {(document.links ?? []).some(
          (link) =>
            link.targetType !== "DOCUMENT" || isRequirementDocumentLink(link),
        ) || (document.tags ?? []).length > 0 ? (
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <DocumentRowLinks links={document.links ?? []} />
            <TagBadgeList tags={document.tags ?? []} />
          </div>
        ) : null}
      </Link>
    </div>
  );
}

function RequirementDocumentBadge({
  displayCode,
  status,
}: {
  displayCode: string | null;
  status: DocumentStatus;
}) {
  const t = useTranslations("documents");
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-primary"
      data-testid="document-requirement-badge"
      title={t("kind.REQUIREMENT")}
    >
      {displayCode ? (
        <span className="font-mono" data-testid="document-display-code">
          {displayCode}
        </span>
      ) : (
        t("kind.REQUIREMENT")
      )}
      <span className="text-primary/70">{t(`status.${status}`)}</span>
    </span>
  );
}

function DocumentRowLinks({ links }: { links: DocumentSummary["links"] }) {
  const t = useTranslations("documents");
  const all = (links ?? []).filter(
    (link) => link.targetType !== "DOCUMENT" || isRequirementDocumentLink(link),
  );
  if (all.length === 0) {
    return null;
  }
  const visible = all.slice(0, 3);
  const overflow = all.length - visible.length;

  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {visible.map((link) => (
        <span
          key={link.id}
          className="inline-flex items-center rounded-md bg-muted px-1.5 py-0.5 font-mono text-[11px] leading-none text-foreground"
          title={link.title}
        >
          {getDocumentLinkDisplayCode(link)}
        </span>
      ))}
      {overflow > 0 ? (
        <span className="text-[11px] text-muted-foreground">
          {t("list.moreResources", { count: overflow })}
        </span>
      ) : null}
    </span>
  );
}

function DocumentLinksSummary({ links }: { links: DocumentSummary["links"] }) {
  const t = useTranslations("documents");
  const [expanded, setExpanded] = useState(false);
  const allLinks = links ?? [];
  const visible = expanded ? allLinks : allLinks.slice(0, 3);
  const overflow = Math.max(allLinks.length - 3, 0);

  if (allLinks.length === 0) {
    return (
      <span className="text-xs text-muted-foreground">
        {t("list.noResources")}
      </span>
    );
  }

  return (
    <div className="flex min-w-0 flex-wrap content-start items-start gap-1">
      {visible.map((link) => (
        <Link
          key={link.id}
          href={getDocumentLinkHref(link)}
          className="inline-flex max-w-full items-center gap-1 rounded-md border border-border bg-background px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          title={link.title}
        >
          <span className="font-mono text-foreground">
            {getDocumentLinkDisplayCode(link)}
          </span>
          <span className="truncate">{link.title}</span>
        </Link>
      ))}
      {overflow > 0 ? (
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="rounded text-[11px] text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {expanded
            ? t("list.collapseResources")
            : t("list.moreResources", { count: overflow })}
        </button>
      ) : null}
    </div>
  );
}

function SourceBadge({
  sourceType,
}: {
  sourceType: DocumentSummary["sourceType"];
}) {
  const t = useTranslations("documents");
  return (
    <Badge variant={sourceType === "MCP_CREATED" ? "info" : "outline"}>
      {sourceType === "MCP_CREATED" ? (
        <Bot className="h-3 w-3" aria-hidden="true" />
      ) : null}
      {t(getDocumentSourceKey(sourceType))}
    </Badge>
  );
}

function ActorBadge({
  actorType,
  mcpClientName,
}: {
  actorType: DocumentSummary["lastEditedVia"];
  mcpClientName?: string | null;
}) {
  const t = useTranslations("documents");
  return (
    <Badge variant={actorType === "MCP_CLIENT" ? "info" : "default"}>
      {actorType === "MCP_CLIENT" ? (
        <Bot className="h-3 w-3" aria-hidden="true" />
      ) : null}
      {actorType === "MCP_CLIENT"
        ? t("actor.viaClient", {
            client: getMcpClientDisplayName(mcpClientName, t),
          })
        : t(getDocumentActorKey(actorType))}
    </Badge>
  );
}

export function formatDocumentCreatedMeta(
  document: DocumentSummary,
  locale: string,
  t: DocumentTranslator,
) {
  const actor = getUserDisplayName(document.createdByName, t);
  const time = formatDocumentRelativeTimestamp(document.createdAt, locale);
  const createdVia =
    document.createdVia ??
    (document.sourceType === "MCP_CREATED" ? "MCP_CLIENT" : "USER");

  if (createdVia === "MCP_CLIENT") {
    return t("meta.createdViaClient", {
      actor,
      client: getMcpClientDisplayName(document.createdMcpClientName, t),
      time,
    });
  }

  return t("meta.createdViaSource", {
    actor,
    source: t(`meta.sourceAction.${document.sourceType}`),
    time,
  });
}

export function formatDocumentEditedMeta(
  document: DocumentSummary,
  locale: string,
  t: DocumentTranslator,
) {
  const actor = getUserDisplayName(document.lastEditedByName, t);
  const time = formatDocumentRelativeTimestamp(document.lastEditedAt, locale);

  if (document.lastEditedVia === "MCP_CLIENT") {
    return t("meta.editedViaClient", {
      actor,
      client: getMcpClientDisplayName(document.lastEditedMcpClientName, t),
      time,
    });
  }

  return t("meta.editedByUser", {
    actor,
    time,
  });
}

function getUserDisplayName(
  value: string | null | undefined,
  t: DocumentTranslator,
) {
  const trimmed = value?.trim();

  return trimmed || t("meta.unknownUser");
}

function getMcpClientDisplayName(
  value: string | null | undefined,
  t: DocumentTranslator,
) {
  const trimmed = value?.trim();

  return trimmed || t("meta.mcpClientFallback");
}

function DocumentsEmptyState() {
  const t = useTranslations("documents");
  return (
    <section
      className="flex min-h-96 flex-col items-center justify-center rounded-lg border border-dashed border-border bg-gradient-to-b from-card to-muted/30 px-6 py-14 text-center"
      data-testid="documents-empty-state"
    >
      <div className="relative">
        <div
          aria-hidden="true"
          className="absolute inset-0 -m-3 rounded-2xl bg-primary/5 blur-md"
        />
        <div className="relative flex h-14 w-14 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <FileText className="h-7 w-7" aria-hidden="true" />
        </div>
      </div>
      <h2 className="mt-5 text-base font-semibold text-foreground">
        {t("empty.title")}
      </h2>
      <p className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
        {t("empty.description")}
      </p>
    </section>
  );
}

function DocumentImportDialog({
  folderId,
  onCreated,
  onOpenChange,
  open,
  organizationId,
  spaceId,
}: {
  folderId?: string | null;
  onCreated: (documentId: string) => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  organizationId?: string;
  spaceId?: string;
}) {
  const t = useTranslations("documents.importDialog");
  const tRoot = useTranslations();
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const canSubmit = Boolean(spaceId && file && getImportKind(file));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!spaceId || !file || !getImportKind(file)) {
      setErrorKey("documents.importDialog.unsupported");
      return;
    }

    setIsSaving(true);
    setErrorKey(null);
    try {
      const kind = getImportKind(file);
      const document =
        kind === "docx"
          ? await importDocxDocument(
              { organizationId, spaceId },
              { file, folderId, title },
            )
          : await importMarkdownDocument(
              { organizationId, spaceId },
              { file, folderId, title },
            );
      onOpenChange(false);
      onCreated(document.id);
    } catch (error) {
      setErrorKey(getApiErrorMessageKey(error));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form className="grid gap-4" onSubmit={(event) => void submit(event)}>
          <DialogHeader>
            <DialogTitle>{t("title")}</DialogTitle>
            <DialogDescription>{t("description")}</DialogDescription>
          </DialogHeader>
          <label className="grid gap-1.5 text-sm">
            <span className="font-medium">{t("titleLabel")}</span>
            <Input
              data-testid="document-import-title-input"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder={t("titlePlaceholder")}
            />
          </label>
          <label className="grid gap-1.5 text-sm">
            <span className="font-medium">{t("fileLabel")}</span>
            <Input
              accept=".md,.markdown,.docx"
              data-testid="document-import-file-input"
              type="file"
              onChange={(event: ChangeEvent<HTMLInputElement>) =>
                setFile(event.target.files?.[0] ?? null)
              }
            />
          </label>
          {errorKey ? (
            <p className="text-sm text-destructive" role="alert">
              {errorKey.startsWith("documents.")
                ? tRoot(errorKey)
                : tRoot(errorKey)}
            </p>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              {t("cancel")}
            </Button>
            <Button type="submit" disabled={!canSubmit || isSaving}>
              {isSaving ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : null}
              {t("submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DocumentPasteDialog({
  folderId,
  onCreated,
  onOpenChange,
  open,
  organizationId,
  spaceId,
}: {
  folderId?: string | null;
  onCreated: (documentId: string) => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  organizationId?: string;
  spaceId?: string;
}) {
  const t = useTranslations("documents.pasteDialog");
  const tRoot = useTranslations();
  const [form, setForm] = useState<DocumentPasteForm>(() =>
    createDocumentPasteForm(),
  );
  const [isSaving, setIsSaving] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!spaceId || !form.contentMarkdown.trim()) {
      return;
    }

    setIsSaving(true);
    setErrorKey(null);
    try {
      const document = await pasteDocument(
        { organizationId, spaceId },
        {
          contentMarkdown: form.contentMarkdown,
          folderId,
          sourceType: form.sourceType,
          title: normalizeDocumentTitle(form.title, form.contentMarkdown),
        },
      );
      onOpenChange(false);
      onCreated(document.id);
    } catch (error) {
      setErrorKey(getApiErrorMessageKey(error));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <form className="grid gap-4" onSubmit={(event) => void submit(event)}>
          <DialogHeader>
            <DialogTitle>{t("title")}</DialogTitle>
            <DialogDescription>{t("description")}</DialogDescription>
          </DialogHeader>
          <label className="grid gap-1.5 text-sm">
            <span className="font-medium">{t("titleLabel")}</span>
            <Input
              data-testid="document-paste-title-input"
              value={form.title}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  title: event.target.value,
                }))
              }
              placeholder={t("titlePlaceholder")}
            />
          </label>
          <label className="grid gap-1.5 text-sm">
            <span className="font-medium">{t("contentLabel")}</span>
            <Textarea
              className="min-h-64 font-mono text-xs leading-5"
              data-testid="document-paste-content-input"
              value={form.contentMarkdown}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  contentMarkdown: event.target.value,
                }))
              }
              placeholder={t("contentPlaceholder")}
            />
          </label>
          {errorKey ? (
            <p className="text-sm text-destructive" role="alert">
              {tRoot(errorKey)}
            </p>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              {t("cancel")}
            </Button>
            <Button
              type="submit"
              disabled={!spaceId || !form.contentMarkdown.trim() || isSaving}
            >
              {isSaving ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : null}
              {t("submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export {
  ActorBadge,
  DocumentImportDialog,
  DocumentLinksSummary,
  DocumentPasteDialog,
  SourceBadge,
};
