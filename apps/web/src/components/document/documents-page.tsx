"use client";

import {
  Archive,
  Bot,
  FilePlus2,
  FileText,
  Loader2,
  Search,
  Upload,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import {
  useCallback,
  useEffect,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";

import { Link, useRouter } from "../../i18n/routing";
import { getApiErrorMessageKey } from "../../lib/api-error-messages";
import type { DocumentFilterKey, DocumentSummary } from "../../lib/document-service";
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
import { Textarea } from "../ui/textarea";

const PAGE_SIZE = 50;
const DOCUMENTS_REALTIME_KEYS = ["document-list", "resource-documents"] as const;

export function DocumentsPage() {
  const t = useTranslations("documents");
  const tRoot = useTranslations();
  const locale = useLocale();
  const router = useRouter();
  const { currentOrganization, currentSpace, session, status } = useSession();
  const organizationId =
    currentOrganization?.id ?? session?.defaultOrganizationId;
  const spaceId = currentSpace?.id ?? session?.defaultSpaceId;
  const [items, setItems] = useState<DocumentSummary[]>([]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<DocumentFilterKey>("all");
  const [isLoading, setIsLoading] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);

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
        query,
        spaceId,
      });
      setItems(result.items);
    } catch (error) {
      if (!isRealtime) {
        setErrorKey(getApiErrorMessageKey(error));
        setItems([]);
      }
    } finally {
      if (!isRealtime) {
        setIsLoading(false);
      }
    }
  }, [filter, organizationId, query, session?.user?.id, spaceId]);

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
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase text-muted-foreground">
              {currentOrganization?.name ?? t("unknownOrganization")}
            </p>
            <h1 className="mt-1 truncate text-2xl font-semibold tracking-normal text-foreground">
              {currentSpace?.name ?? t("unknownSpace")}
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              {t("home.subtitle")}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setPasteOpen(true)}
              data-testid="documents-paste-button"
            >
              <FilePlus2 className="h-4 w-4" aria-hidden="true" />
              {t("home.paste")}
            </Button>
            <Button
              type="button"
              onClick={() => setImportOpen(true)}
              data-testid="documents-import-button"
            >
              <Upload className="h-4 w-4" aria-hidden="true" />
              {t("home.import")}
            </Button>
          </div>
        </div>

        <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
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
          <div
            className="flex gap-1 overflow-x-auto pb-1 xl:pb-0"
            aria-label={t("home.filtersLabel")}
          >
            {getDocumentFilterKeys().map((key) => (
              <button
                key={key}
                type="button"
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

      {showEmpty ? <DocumentsEmptyState onImport={() => setImportOpen(true)} onPaste={() => setPasteOpen(true)} /> : null}

      {!isLoading && items.length > 0 ? (
        <DocumentList items={items} locale={locale} />
      ) : null}

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
  );
}

function DocumentList({
  items,
  locale,
}: {
  items: DocumentSummary[];
  locale: string;
}) {
  const t = useTranslations("documents");

  return (
    <div className="overflow-hidden rounded-md border border-border bg-card" data-testid="documents-list">
      <div className="hidden grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(12rem,0.9fr)] gap-4 border-b border-border bg-muted/40 px-4 py-2 text-xs font-medium text-muted-foreground md:grid">
        <span>{t("list.document")}</span>
        <span>{t("list.resources")}</span>
        <span>{t("list.updated")}</span>
      </div>
      <div className="divide-y divide-border">
        {items.map((document) => (
          <Link
            key={document.id}
            href={`/documents/${document.id}`}
            className="grid gap-3 px-4 py-4 transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(12rem,0.9fr)]"
            data-testid="documents-list-item"
          >
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-2">
                <FileText className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="truncate text-sm font-semibold text-foreground">
                  {document.title || t("untitled")}
                </span>
                {document.status === "ARCHIVED" ? (
                  <Badge className="shrink-0" variant="default">
                    <Archive className="h-3 w-3" aria-hidden="true" />
                    {t("status.ARCHIVED")}
                  </Badge>
                ) : null}
              </div>
              {document.contentSnippet ? (
                <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
                  {document.contentSnippet}
                </p>
              ) : null}
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <SourceBadge sourceType={document.sourceType} />
                <ActorBadge
                  actorType={document.lastEditedVia}
                  mcpClientName={document.lastEditedMcpClientName}
                />
                <TagBadgeList tags={document.tags ?? []} />
              </div>
            </div>
            <DocumentLinksSummary links={document.links ?? []} />
            <div className="flex flex-col gap-1 text-xs text-muted-foreground md:items-end md:text-right">
              <span>{formatDocumentRelativeTimestamp(document.lastEditedAt, locale)}</span>
              <span>{t("list.revision", { revision: document.revision })}</span>
            </div>
          </Link>
        ))}
      </div>
    </div>
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
    <div className="flex min-w-0 flex-wrap gap-1">
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
      {mcpClientName ?? t(getDocumentActorKey(actorType))}
    </Badge>
  );
}

function DocumentsEmptyState({
  onImport,
  onPaste,
}: {
  onImport: () => void;
  onPaste: () => void;
}) {
  const t = useTranslations("documents");
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
        <Button type="button" onClick={onImport}>
          <Upload className="h-4 w-4" aria-hidden="true" />
          {t("home.import")}
        </Button>
        <Button type="button" variant="outline" onClick={onPaste}>
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

export { DocumentLinksSummary, SourceBadge, ActorBadge };
