"use client";

import {
  AlignJustify,
  Archive,
  Bot,
  FilePlus2,
  FileText,
  List,
  Loader2,
  Search,
  Upload,
  User,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import {
  useCallback,
  useEffect,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";

import { Link } from "../../i18n/routing";
import { getApiErrorMessageKey } from "../../lib/api-error-messages";
import type {
  DocumentFilterKey,
  DocumentSortBy,
  DocumentSummary,
} from "../../lib/document-service";
import {
  importDocxDocument,
  importMarkdownDocument,
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
  getDocumentFilterKeys,
  getDocumentLinkDisplayCode,
  getDocumentSourceKey,
} from "../../lib/document-view-model";
import { useRealtimeInvalidation } from "../../lib/realtime";
import { cn } from "../../lib/utils";
import { useDocumentCreate } from "./document-create-context";
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
const DOCUMENTS_REALTIME_KEYS = ["document-list", "resource-documents"] as const;
const DENSITY_STORAGE_KEY = "documents.list.density";

const SORT_OPTIONS = {
  recentEdited: { dateField: "lastEditedAt", sortBy: "lastEditedAt", sortOrder: "desc" },
  recentCreated: { dateField: "createdAt", sortBy: "createdAt", sortOrder: "desc" },
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
  const { currentOrganization, currentSpace, session, status } = useSession();
  const organizationId =
    currentOrganization?.id ?? session?.defaultOrganizationId;
  const spaceId = currentSpace?.id ?? session?.defaultSpaceId;
  const [items, setItems] = useState<DocumentSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [filter, setFilter] = useState<DocumentFilterKey>("all");
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [sort, setSort] = useState<DocumentSortKey>("recentEdited");
  const [density, setDensity] = useState<DocumentDensity>("comfortable");

  useEffect(() => {
    const stored = window.localStorage.getItem(DENSITY_STORAGE_KEY);
    if (stored === "comfortable" || stored === "compact") {
      setDensity(stored);
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(DENSITY_STORAGE_KEY, density);
  }, [density]);

  const loadDocuments = useCallback(async (options?: { realtime?: boolean }) => {
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
        organizationId,
        page: 1,
        pageSize: PAGE_SIZE,
        query: debouncedQuery,
        sortBy: SORT_OPTIONS[sort].sortBy,
        sortOrder: SORT_OPTIONS[sort].sortOrder,
        spaceId,
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
  }, [filter, organizationId, debouncedQuery, session?.user?.id, sort, spaceId]);

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
        organizationId,
        page: nextPage,
        pageSize: PAGE_SIZE,
        query: debouncedQuery,
        sortBy: SORT_OPTIONS[sort].sortBy,
        sortOrder: SORT_OPTIONS[sort].sortOrder,
        spaceId,
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

  useRealtimeInvalidation(DOCUMENTS_REALTIME_KEYS, () => {
    if (status !== "authenticated") {
      return;
    }
    void loadDocuments({ realtime: true });
  });

  const showEmpty = !isLoading && !errorKey && items.length === 0;

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 py-5 md:px-6">
      <section className="flex flex-col gap-4 border-b border-border pb-5">
        <h1 className="sr-only">
          {currentSpace?.name ?? t("unknownSpace")}
        </h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          {t("home.subtitle")}
        </p>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <label className="relative min-w-0 flex-1">
            <span className="sr-only">{t("home.searchLabel")}</span>
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              className="pl-9"
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
              className="flex h-9 shrink-0 items-center rounded-md border border-border p-0.5"
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
          </div>
        </div>

        <div
          className="flex gap-1 overflow-x-auto pb-1"
          aria-label={t("home.filtersLabel")}
        >
          {getDocumentFilterKeys().map((key) => (
            <button
              key={key}
              type="button"
              aria-pressed={filter === key}
              className={cn(
                "inline-flex h-8 shrink-0 items-center rounded-md border px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                filter === key
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
              data-testid={`documents-filter-${key.replace(/[A-Z]/gu, (m) => `-${m.toLowerCase()}`)}`}
              onClick={() => setFilter(key)}
            >
              {t(`filters.${key}`)}
            </button>
          ))}
        </div>
      </section>

      {errorKey ? (
        <div
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
          data-testid="documents-error"
        >
          {tRoot(errorKey)}
        </div>
      ) : null}

      {isLoading ? (
        <div className="flex min-h-64 items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          {t("home.loading")}
        </div>
      ) : null}

      {showEmpty ? <DocumentsEmptyState /> : null}

      {!isLoading && items.length > 0 ? (
        <DocumentList
          dateField={SORT_OPTIONS[sort].dateField}
          density={density}
          items={items}
          locale={locale}
        />
      ) : null}

      {!isLoading && items.length > 0 && items.length < total ? (
        <div className="flex justify-center">
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

type DocumentGroupKey = "today" | "thisWeek" | "thisMonth" | "earlier";

function getDateBucket(iso: string): DocumentGroupKey {
  const date = new Date(iso);
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
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
  const order: DocumentGroupKey[] = ["today", "thisWeek", "thisMonth", "earlier"];
  const buckets = new Map<DocumentGroupKey, DocumentSummary[]>();
  for (const item of items) {
    const value = dateField === "createdAt" ? item.createdAt : item.lastEditedAt;
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
}: {
  dateField: "lastEditedAt" | "createdAt" | null;
  density: DocumentDensity;
  items: DocumentSummary[];
  locale: string;
}) {
  const t = useTranslations("documents");
  const groups = groupDocumentsByDate(items, dateField);

  return (
    <div
      className="overflow-hidden rounded-md border border-border bg-card"
      data-testid="documents-list"
    >
      <div className="divide-y divide-border">
        {groups.map((group) => (
          <div key={group.key}>
            {group.key !== "all" ? (
              <h2
                className="bg-muted/40 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
                data-testid={`documents-group-${group.key}`}
              >
                {t(`group.${group.key}`)}
              </h2>
            ) : null}
            <div className="divide-y divide-border">
              {group.items.map((document) => (
                <DocumentRow
                  key={document.id}
                  density={density}
                  document={document}
                  locale={locale}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function DocumentRow({
  density,
  document,
  locale,
}: {
  density: DocumentDensity;
  document: DocumentSummary;
  locale: string;
}) {
  const t = useTranslations("documents");
  const isAi =
    document.sourceType === "MCP_CREATED" || document.lastEditedVia === "MCP_CLIENT";
  const SourceIcon = isAi ? Bot : User;
  const revisionLabel = t("list.revision", { revision: document.revision });

  return (
    <Link
      href={`/documents/${document.id}`}
      className={cn(
        "block px-4 transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        density === "compact" ? "py-2" : "py-3",
      )}
      data-testid="documents-list-item"
    >
      <div className="flex min-w-0 items-center gap-2">
        <SourceIcon
          className="h-4 w-4 shrink-0 text-muted-foreground"
          aria-hidden="true"
        />
        <span className="truncate text-sm font-semibold text-foreground">
          {document.title || t("untitled")}
        </span>
        {document.status === "ARCHIVED" ? (
          <Badge className="shrink-0" variant="default">
            <Archive className="h-3 w-3" aria-hidden="true" />
            {t("status.ARCHIVED")}
          </Badge>
        ) : null}
        <span
          className="ml-auto shrink-0 text-[11px] text-muted-foreground"
          title={revisionLabel}
        >
          {revisionLabel}
        </span>
      </div>
      <div
        className={cn(
          "flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground",
          density === "compact" ? "mt-0.5" : "mt-1",
        )}
      >
        <span>{formatDocumentCreatedMeta(document, locale, t)}</span>
        <DocumentRowLinks links={document.links ?? []} />
        <TagBadgeList tags={document.tags ?? []} />
      </div>
    </Link>
  );
}

function DocumentRowLinks({ links }: { links: DocumentSummary["links"] }) {
  const t = useTranslations("documents");
  const all = (links ?? []).filter((link) => link.targetType !== "DOCUMENT");
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
          className="inline-flex items-center rounded border border-border bg-background px-1.5 py-0.5 font-mono text-[11px] text-foreground"
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
  const visible = (links ?? []).slice(0, 3);
  const overflow = Math.max((links ?? []).length - visible.length, 0);

  if (visible.length === 0) {
    return <span className="text-xs text-muted-foreground">{t("list.noResources")}</span>;
  }

  return (
    <div className="flex min-w-0 flex-wrap content-start items-start gap-1">
      {visible.map((link) => (
        <span
          key={link.id}
          className="inline-flex max-w-full items-center gap-1 rounded-md border border-border bg-background px-1.5 py-0.5 text-[11px] text-muted-foreground"
          title={link.title}
        >
          <span className="font-mono text-foreground">
            {getDocumentLinkDisplayCode(link)}
          </span>
          <span className="truncate">{link.title}</span>
        </span>
      ))}
      {overflow > 0 ? (
        <span className="text-[11px] text-muted-foreground">
          {t("list.moreResources", { count: overflow })}
        </span>
      ) : null}
    </div>
  );
}

function SourceBadge({ sourceType }: { sourceType: DocumentSummary["sourceType"] }) {
  const t = useTranslations("documents");
  return (
    <Badge variant={sourceType === "MCP_CREATED" ? "info" : "outline"}>
      {sourceType === "MCP_CREATED" ? <Bot className="h-3 w-3" aria-hidden="true" /> : null}
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
      {actorType === "MCP_CLIENT" ? <Bot className="h-3 w-3" aria-hidden="true" /> : null}
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

function getUserDisplayName(value: string | null | undefined, t: DocumentTranslator) {
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
  const { openImport, openPaste } = useDocumentCreate();
  return (
    <section
      className="flex min-h-80 flex-col items-center justify-center rounded-md border border-dashed border-border bg-card px-5 py-10 text-center"
      data-testid="documents-empty-state"
    >
      <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <FileText className="h-6 w-6" aria-hidden="true" />
      </div>
      <h2 className="mt-4 text-base font-semibold">{t("empty.title")}</h2>
      <p className="mt-2 max-w-lg text-sm text-muted-foreground">
        {t("empty.description")}
      </p>
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        <Button type="button" onClick={openImport} data-testid="documents-empty-import-button">
          <Upload className="h-4 w-4" aria-hidden="true" />
          {t("home.import")}
        </Button>
        <Button type="button" variant="outline" onClick={openPaste} data-testid="documents-empty-paste-button">
          <FilePlus2 className="h-4 w-4" aria-hidden="true" />
          {t("home.paste")}
        </Button>
      </div>
    </section>
  );
}

function DocumentImportDialog({
  onCreated,
  onOpenChange,
  open,
  organizationId,
  spaceId,
}: {
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
          ? await importDocxDocument({ organizationId, spaceId }, { file, title })
          : await importMarkdownDocument({ organizationId, spaceId }, { file, title });
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
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t("cancel")}
            </Button>
            <Button type="submit" disabled={!canSubmit || isSaving}>
              {isSaving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
              {t("submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DocumentPasteDialog({
  onCreated,
  onOpenChange,
  open,
  organizationId,
  spaceId,
}: {
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
                setForm((current) => ({ ...current, title: event.target.value }))
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
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t("cancel")}
            </Button>
            <Button
              type="submit"
              disabled={!spaceId || !form.contentMarkdown.trim() || isSaving}
            >
              {isSaving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
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
