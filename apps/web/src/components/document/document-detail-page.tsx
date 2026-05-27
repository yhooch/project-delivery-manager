"use client";

import {
  Archive,
  ChevronRight,
  Clock3,
  Download,
  FileText,
  Link2,
  Loader2,
  MessageSquare,
  Paperclip,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Send,
  Tags,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type ReactNode,
} from "react";
import type { Attachment, Comment, TimelineEvent } from "@project-delivery/shared";

import { Link, useRouter } from "../../i18n/routing";
import { getApiErrorMessageKey } from "../../lib/api-error-messages";
import { ApiClientError } from "../../lib/api-client";
import {
  AttachmentUploadError,
  createAttachmentDownloadUrl,
  listAttachments,
  uploadAttachment,
} from "../../lib/attachment-service";
import { createComment, listComments } from "../../lib/comment-service";
import type {
  DocumentDetail,
  DocumentLinkSummary,
  DocumentSummary,
} from "../../lib/document-service";
import {
  archiveDocument,
  deleteDocument,
  getDocument,
  listDocuments,
  reimportDocument,
  restoreDocument,
  updateDocument,
} from "../../lib/document-service";
import {
  createDocumentEditForm,
  getDocumentTagIds,
  getImportKind,
  splitLinkedResourceCodes,
  type DocumentEditForm,
} from "../../lib/document-forms";
import {
  formatDocumentRelativeTimestamp,
  getDocumentLinkDisplayCode,
  getDocumentLinkHref,
  getDocumentSourceKey,
  getLookupTargetType,
} from "../../lib/document-view-model";
import { lookupObjectCode } from "../../lib/object-code-service";
import {
  realtimeContextIncludesTarget,
  useRealtimeInvalidation,
} from "../../lib/realtime";
import { listTimeline } from "../../lib/timeline-service";
import { cn } from "../../lib/utils";
import { useSession } from "../providers/session-provider";
import { TagBadgeList, TagSelectionField } from "../tag";
import { recordRecentOpen } from "../shell/recent-opens";
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
import {
  ActorBadge,
  DocumentLinksSummary,
  SourceBadge,
  formatDocumentCreatedMeta,
  formatDocumentEditedMeta,
} from "./documents-page";
import {
  DocumentMarkdownViewer,
  getDocumentMarkdownHeadings,
  type MarkdownHeading,
} from "./document-markdown-viewer";

type DocumentDetailPageProps = {
  documentId: string;
};

const DOCUMENT_DETAIL_REALTIME_KEYS = [
  "document-detail",
  "document-links",
  "document-comments",
  "document-attachments",
  "document-timeline",
] as const;
const DOCUMENT_LINK_SEARCH_PAGE_SIZE = 8;

export function DocumentDetailPage({ documentId }: DocumentDetailPageProps) {
  const t = useTranslations("documents");
  const tRoot = useTranslations();
  const locale = useLocale();
  const router = useRouter();
  const { currentOrganization, currentSpace, session, status } = useSession();
  const organizationId =
    currentOrganization?.id ?? session?.defaultOrganizationId;
  const [document, setDocument] = useState<DocumentDetail | null>(null);
  const [form, setForm] = useState<DocumentEditForm | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isArchiving, setIsArchiving] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [hasRealtimeRevision, setHasRealtimeRevision] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [contentPreview, setContentPreview] = useState(false);
  const [reimportFile, setReimportFile] = useState<File | null>(null);
  const [commentBody, setCommentBody] = useState("");
  const [isCommenting, setIsCommenting] = useState(false);
  const [commentErrorKey, setCommentErrorKey] = useState<string | null>(null);
  const [isUploadingAttachment, setIsUploadingAttachment] = useState(false);
  const [attachmentErrorKey, setAttachmentErrorKey] = useState<string | null>(
    null,
  );
  const [documentSearch, setDocumentSearch] = useState("");
  const [documentSearchResults, setDocumentSearchResults] = useState<
    DocumentSummary[]
  >([]);
  const [isSearchingDocuments, setIsSearchingDocuments] = useState(false);
  const [documentSearchErrorKey, setDocumentSearchErrorKey] = useState<
    string | null
  >(null);
  const formRef = useRef<DocumentEditForm | null>(null);
  const editModeRef = useRef(false);
  const spaceId = document?.spaceId ?? currentSpace?.id ?? session?.defaultSpaceId;

  useEffect(() => {
    formRef.current = form;
  }, [form]);

  useEffect(() => {
    editModeRef.current = editMode;
  }, [editMode]);

  const loadDocument = useCallback(async (options?: { realtime?: boolean; preserveForm?: boolean }) => {
    const isRealtime = options?.realtime === true;
    const preserveForm =
      options?.preserveForm ?? (isRealtime && editModeRef.current);

    if (!isRealtime) {
      setIsLoading(true);
      setErrorKey(null);
    }
    try {
      const next = await getDocumentWithSubresources({
        documentId,
        organizationId,
        spaceId,
      });
      setDocument(next);
      if (preserveForm) {
        const baseRevision = formRef.current?.baseRevision;
        setForm((current) => current ?? createDocumentEditForm(next));
        if (baseRevision !== undefined && next.revision > baseRevision) {
          setHasRealtimeRevision(true);
        }
      } else {
        const nextForm = createDocumentEditForm(next);
        setForm(nextForm);
        formRef.current = nextForm;
        setHasRealtimeRevision(false);
      }
      if (!isRealtime) {
        recordRecentOpen(
          {
            displayCode: "Document",
            href: `/documents/${next.id}`,
            id: next.id,
            organizationId: next.organizationId,
            spaceId: next.spaceId,
            title: next.title || "Untitled document",
            type: "DOCUMENT",
          },
          { organizationId: next.organizationId, spaceId: next.spaceId },
        );
      }
      if (!preserveForm) {
        setConflict(false);
      }
    } catch (error) {
      if (!isRealtime) {
        setErrorKey(getApiErrorMessageKey(error));
      }
    } finally {
      if (!isRealtime) {
        setIsLoading(false);
      }
    }
  }, [documentId, organizationId, spaceId]);

  useEffect(() => {
    if (status !== "authenticated") {
      return;
    }
    void loadDocument();
  }, [loadDocument, status]);

  useRealtimeInvalidation(DOCUMENT_DETAIL_REALTIME_KEYS, (context) => {
    if (
      status !== "authenticated" ||
      !realtimeContextIncludesTarget(context, {
        id: documentId,
        type: "DOCUMENT",
      })
    ) {
      return;
    }

    void loadDocument({ realtime: true });
  });

  useEffect(() => {
    const query = documentSearch.trim();
    if (!editMode || !document || !query) {
      setDocumentSearchResults([]);
      setIsSearchingDocuments(false);
      setDocumentSearchErrorKey(null);
      return;
    }

    let cancelled = false;
    setIsSearchingDocuments(true);
    setDocumentSearchErrorKey(null);

    void listDocuments({
      organizationId: document.organizationId,
      page: 1,
      pageSize: DOCUMENT_LINK_SEARCH_PAGE_SIZE,
      query,
      spaceId: document.spaceId,
    })
      .then((result) => {
        if (cancelled) {
          return;
        }
        const selectedDocumentIds = new Set(
          formRef.current?.linkedDocuments.map((link) => link.targetId) ?? [],
        );
        setDocumentSearchResults(
          result.items.filter(
            (item) => item.id !== document.id && !selectedDocumentIds.has(item.id),
          ),
        );
      })
      .catch((error) => {
        if (!cancelled) {
          setDocumentSearchErrorKey(getApiErrorMessageKey(error));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsSearchingDocuments(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [document, documentSearch, editMode]);

  const headingsSource =
    editMode && form ? form.contentMarkdown : document?.contentMarkdown ?? "";
  const headings = useMemo<MarkdownHeading[]>(
    () => getDocumentMarkdownHeadings(headingsSource),
    [headingsSource],
  );

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!document || !form) {
      return;
    }

    setIsSaving(true);
    setErrorKey(null);
    setConflict(false);
    try {
      const linkTargets = await resolveLinkTargets({
        codes: splitLinkedResourceCodes(form.linkedResourceCodes),
        organizationId: document.organizationId,
        spaceId: document.spaceId,
      });
      const linkedDocumentTargets = form.linkedDocuments.map((link) => ({
        targetId: link.targetId,
        targetType: "DOCUMENT" as const,
      }));
      const next = await updateDocument({
        baseRevision: form.baseRevision,
        contentMarkdown: form.contentMarkdown,
        documentId: document.id,
        linkTargets: dedupeLinkTargets([...linkedDocumentTargets, ...linkTargets]),
        tagIds: getDocumentTagIds(form.selectedTags),
        title: form.title.trim() || t("untitled"),
      });
      setDocument(next);
      setForm(createDocumentEditForm(next));
      setEditMode(false);
      setHasRealtimeRevision(false);
    } catch (error) {
      if (isConflictError(error)) {
        setConflict(true);
      } else {
        setErrorKey(getApiErrorMessageKey(error));
      }
    } finally {
      setIsSaving(false);
    }
  };

  const reimport = async () => {
    if (!document || !form || !reimportFile || !getImportKind(reimportFile)) {
      return;
    }

    setIsSaving(true);
    setErrorKey(null);
    setConflict(false);
    try {
      const next = await reimportDocument({
        baseRevision: form.baseRevision,
        documentId: document.id,
        file: reimportFile,
      });
      setDocument(next);
      setForm(createDocumentEditForm(next));
      setReimportFile(null);
      setEditMode(false);
      setHasRealtimeRevision(false);
    } catch (error) {
      if (isConflictError(error)) {
        setConflict(true);
      } else {
        setErrorKey(getApiErrorMessageKey(error));
      }
    } finally {
      setIsSaving(false);
    }
  };

  const archive = async () => {
    if (!document) {
      return;
    }

    setIsArchiving(true);
    setErrorKey(null);
    try {
      const next = await archiveDocument(document.id);
      setDocument(next);
      setForm(createDocumentEditForm(next));
      setHasRealtimeRevision(false);
    } catch (error) {
      setErrorKey(getApiErrorMessageKey(error));
    } finally {
      setIsArchiving(false);
    }
  };

  const restore = async () => {
    if (!document) {
      return;
    }

    setIsRestoring(true);
    setErrorKey(null);
    try {
      const next = await restoreDocument(document.id);
      setDocument(next);
      setForm(createDocumentEditForm(next));
      setHasRealtimeRevision(false);
    } catch (error) {
      setErrorKey(getApiErrorMessageKey(error));
    } finally {
      setIsRestoring(false);
    }
  };

  const remove = async () => {
    if (!document) {
      return;
    }

    setIsDeleting(true);
    setErrorKey(null);
    try {
      await deleteDocument(document.id);
      setDeleteDialogOpen(false);
      router.push("/documents");
    } catch (error) {
      setErrorKey(getApiErrorMessageKey(error));
    } finally {
      setIsDeleting(false);
    }
  };

  const submitComment = async () => {
    if (!document || !commentBody.trim()) {
      return;
    }

    setIsCommenting(true);
    setCommentErrorKey(null);
    try {
      await createComment({
        body: commentBody.trim(),
        organizationId: document.organizationId,
        spaceId: document.spaceId,
        targetId: document.id,
        targetType: "DOCUMENT",
      });
      setCommentBody("");
      await loadDocument({
        preserveForm: editModeRef.current,
        realtime: true,
      });
    } catch (error) {
      setCommentErrorKey(getApiErrorMessageKey(error));
    } finally {
      setIsCommenting(false);
    }
  };

  const uploadDocumentAttachment = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    event.target.value = "";
    if (!document || !file) {
      return;
    }

    setIsUploadingAttachment(true);
    setAttachmentErrorKey(null);
    try {
      await uploadAttachment({
        existingAttachmentCount: document.attachments?.length ?? 0,
        file,
        targetId: document.id,
        targetType: "DOCUMENT",
      });
      await loadDocument({
        preserveForm: editModeRef.current,
        realtime: true,
      });
    } catch (error) {
      setAttachmentErrorKey(
        error instanceof AttachmentUploadError
          ? `forms.attachments.uploadErrors.${error.code}`
          : getApiErrorMessageKey(error),
      );
    } finally {
      setIsUploadingAttachment(false);
    }
  };

  const addLinkedDocument = (linkedDocument: DocumentSummary) => {
    setForm((current) => {
      if (
        !current ||
        current.linkedDocuments.some((link) => link.targetId === linkedDocument.id)
      ) {
        return current;
      }

      return {
        ...current,
        linkedDocuments: [
          ...current.linkedDocuments,
          toDocumentLinkSummary(linkedDocument),
        ],
      };
    });
    setDocumentSearch("");
    setDocumentSearchResults([]);
  };

  const removeLinkedDocument = (targetId: string) => {
    setForm((current) =>
      current
        ? {
            ...current,
            linkedDocuments: current.linkedDocuments.filter(
              (link) => link.targetId !== targetId,
            ),
          }
        : current,
    );
  };

  if (isLoading && !document) {
    return (
      <div className="flex min-h-[calc(100vh-3rem)] items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        {t("detail.loading")}
      </div>
    );
  }

  if (errorKey && !document) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8">
        <div
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          {tRoot(errorKey)}
        </div>
      </div>
    );
  }

  if (!document || !form) {
    return null;
  }

  return (
    <>
      <div className="mx-auto grid w-full max-w-7xl gap-6 px-4 py-5 lg:grid-cols-[minmax(0,1fr)_18rem] lg:px-6">
      <div className="min-w-0">
        <form onSubmit={(event) => void save(event)}>
        <div className="mb-5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          <Link className="hover:text-foreground hover:underline" href="/">
            {currentOrganization?.name ?? t("unknownOrganization")}
          </Link>
          <span>/</span>
          <Link className="hover:text-foreground hover:underline" href="/documents">
            {currentSpace?.name ?? t("unknownSpace")}
          </Link>
          <span>/</span>
          <span>{t("title")}</span>
        </div>

        <section className="border-b border-border pb-5">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div className="min-w-0 flex-1">
              {editMode ? (
                <Input
                  aria-label={t("edit.titleLabel")}
                  className="h-auto px-0 py-1 text-2xl font-semibold tracking-normal shadow-none md:text-3xl"
                  data-testid="document-title-input"
                  value={form.title}
                  onChange={(event) =>
                    setForm((current) =>
                      current ? { ...current, title: event.target.value } : current,
                    )
                  }
                />
              ) : (
                <h1 className="break-words text-2xl font-semibold tracking-normal text-foreground md:text-3xl">
                  {document.title || t("untitled")}
                </h1>
              )}
              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                <Badge variant={document.status === "ARCHIVED" ? "default" : "success"}>
                  {t(`status.${document.status}`)}
                </Badge>
                <SourceBadge sourceType={document.sourceType} />
                <ActorBadge
                  actorType={document.lastEditedVia}
                  mcpClientName={document.lastEditedMcpClientName}
                />
              </div>
              <div className="mt-2 grid gap-1 text-xs text-muted-foreground">
                <p>{formatDocumentCreatedMeta(document, locale, t)}</p>
                <p>{formatDocumentEditedMeta(document, locale, t)}</p>
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              {editMode ? (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      const nextForm = createDocumentEditForm(document);
                      setForm(nextForm);
                      formRef.current = nextForm;
                      setEditMode(false);
                      setConflict(false);
                      setHasRealtimeRevision(false);
                    }}
                  >
                    {t("actions.cancel")}
                  </Button>
                  <Button type="submit" disabled={isSaving} data-testid="document-save-button">
                    {isSaving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Save className="h-4 w-4" aria-hidden="true" />}
                    {t("actions.save")}
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setContentPreview(false);
                      setEditMode(true);
                    }}
                    data-testid="document-edit-button"
                  >
                    <Pencil className="h-4 w-4" aria-hidden="true" />
                    {t("actions.edit")}
                  </Button>
                  {document.status === "ARCHIVED" ? (
                    <>
                      <Button
                        type="button"
                        variant="outline"
                        disabled={isRestoring}
                        onClick={() => void restore()}
                        data-testid="document-restore-button"
                      >
                        {isRestoring ? (
                          <Loader2
                            className="h-4 w-4 animate-spin"
                            aria-hidden="true"
                          />
                        ) : (
                          <RotateCcw className="h-4 w-4" aria-hidden="true" />
                        )}
                        {t("actions.restore")}
                      </Button>
                      <Button
                        type="button"
                        variant="destructive"
                        disabled={isDeleting}
                        onClick={() => setDeleteDialogOpen(true)}
                        data-testid="document-delete-button"
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                        {t("actions.delete")}
                      </Button>
                    </>
                  ) : (
                    <Button
                      type="button"
                      variant="ghost"
                      disabled={isArchiving}
                      onClick={() => void archive()}
                    >
                      {isArchiving ? (
                        <Loader2
                          className="h-4 w-4 animate-spin"
                          aria-hidden="true"
                        />
                      ) : (
                        <Archive className="h-4 w-4" aria-hidden="true" />
                      )}
                      {t("actions.archive")}
                    </Button>
                  )}
                </>
              )}
            </div>
          </div>

          <LinkedResourceChips links={document.links ?? []} />
        </section>

        {hasRealtimeRevision ? (
          <div
            role="status"
            className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning"
            data-testid="document-new-version-alert"
          >
            <span>{t("detail.newVersion")}</span>
            <Button
              size="sm"
              type="button"
              variant="outline"
              onClick={() => void loadDocument()}
            >
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
              {t("actions.refresh")}
            </Button>
          </div>
        ) : null}

        {conflict ? (
          <div
            role="alert"
            className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning"
            data-testid="document-conflict-alert"
          >
            <span>{t("detail.conflict")}</span>
            <Button size="sm" type="button" variant="outline" onClick={() => void loadDocument()}>
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
              {t("actions.refresh")}
            </Button>
          </div>
        ) : null}

        {errorKey ? (
          <div
            role="alert"
            className="mt-4 rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
          >
            {tRoot(errorKey)}
          </div>
        ) : null}

        {editMode ? (
          <section className="mt-5 grid gap-5" data-testid="document-edit-panel">
            <div className="grid gap-1.5 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium" id="document-content-label">
                  {t("edit.contentLabel")}
                </span>
                <div
                  className="flex gap-1"
                  role="group"
                  aria-label={t("edit.contentViewLabel")}
                >
                  {([false, true] as const).map((preview) => (
                    <button
                      key={preview ? "preview" : "source"}
                      type="button"
                      aria-pressed={contentPreview === preview}
                      className={cn(
                        "inline-flex h-7 items-center rounded-md border px-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        contentPreview === preview
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground",
                      )}
                      data-testid={
                        preview
                          ? "document-content-preview-tab"
                          : "document-content-source-tab"
                      }
                      onClick={() => setContentPreview(preview)}
                    >
                      {preview ? t("edit.previewTab") : t("edit.sourceTab")}
                    </button>
                  ))}
                </div>
              </div>
              {contentPreview ? (
                <DocumentMarkdownViewer
                  className="min-h-[28rem] rounded-md border border-border p-4"
                  markdown={form.contentMarkdown}
                  organizationId={document.organizationId}
                  spaceId={document.spaceId}
                />
              ) : (
                <Textarea
                  aria-labelledby="document-content-label"
                  className="min-h-[28rem] font-mono text-xs leading-5"
                  data-testid="document-content-input"
                  value={form.contentMarkdown}
                  onChange={(event) =>
                    setForm((current) =>
                      current
                        ? { ...current, contentMarkdown: event.target.value }
                        : current,
                    )
                  }
                />
              )}
            </div>
            {spaceId ? (
              <div className="grid gap-1.5 text-sm">
                <span className="font-medium">{t("edit.tagsLabel")}</span>
                <TagSelectionField
                  organizationId={organizationId}
                  selectedTags={form.selectedTags}
                  spaceId={spaceId}
                  testId="document-tags-field"
                  onSelectedTagsChange={(tags) =>
                    setForm((current) =>
                      current ? { ...current, selectedTags: tags } : current,
                    )
                  }
                />
              </div>
            ) : null}
            <label className="grid gap-1.5 text-sm">
              <span className="font-medium">{t("edit.linksLabel")}</span>
              <Input
                data-testid="document-links-input"
                value={form.linkedResourceCodes}
                onChange={(event) =>
                  setForm((current) =>
                    current
                      ? { ...current, linkedResourceCodes: event.target.value }
                      : current,
                  )
                }
                placeholder={t("edit.linksPlaceholder")}
              />
            </label>
            <LinkedDocumentSelector
              errorKey={documentSearchErrorKey}
              isLoading={isSearchingDocuments}
              onAddDocument={addLinkedDocument}
              onQueryChange={setDocumentSearch}
              onRemoveDocument={removeLinkedDocument}
              query={documentSearch}
              results={documentSearchResults}
              selectedDocuments={form.linkedDocuments}
            />
            <div className="grid gap-2 rounded-md border border-border bg-muted/30 p-3">
              <label className="grid gap-1.5 text-sm">
                <span className="font-medium">{t("edit.reimportLabel")}</span>
                <Input
                  accept=".md,.markdown,.docx"
                  data-testid="document-reimport-input"
                  type="file"
                  onChange={(event: ChangeEvent<HTMLInputElement>) =>
                    setReimportFile(event.target.files?.[0] ?? null)
                  }
                />
              </label>
              <div>
                <Button
                  type="button"
                  variant="outline"
                  disabled={!reimportFile || !getImportKind(reimportFile) || isSaving}
                  onClick={() => void reimport()}
                >
                  <RefreshCw className="h-4 w-4" aria-hidden="true" />
                  {t("actions.reimport")}
                </Button>
              </div>
            </div>
          </section>
        ) : (
          <DocumentMarkdownViewer
            className="mt-6"
            markdown={document.contentMarkdown}
            organizationId={document.organizationId}
            spaceId={document.spaceId}
          />
        )}
        </form>

        <DocumentManagementSections
          attachmentErrorKey={attachmentErrorKey}
          commentBody={commentBody}
          commentErrorKey={commentErrorKey}
          document={document}
          isCommenting={isCommenting}
          isUploadingAttachment={isUploadingAttachment}
          locale={locale}
          onAttachmentChange={(event) => void uploadDocumentAttachment(event)}
          onCommentBodyChange={setCommentBody}
          onSubmitComment={() => void submitComment()}
        />
      </div>

      <DocumentContextRail
        document={document}
        headings={headings}
        locale={locale}
      />
      </div>
      <DocumentDeleteDialog
        documentTitle={document.title || t("untitled")}
        isDeleting={isDeleting}
        onConfirm={() => void remove()}
        onOpenChange={setDeleteDialogOpen}
        open={deleteDialogOpen}
      />
    </>
  );
}

function LinkedResourceChips({
  links,
}: {
  links: NonNullable<DocumentDetail["links"]>;
}) {
  const t = useTranslations("documents");
  if (links.length === 0) {
    return (
      <p className="mt-4 text-sm text-muted-foreground">{t("detail.noLinks")}</p>
    );
  }

  return (
    <div className="mt-4 flex flex-wrap gap-1.5" data-testid="document-linked-resources">
      {links.map((link) => (
        <Button key={link.id} asChild size="sm" variant="outline">
          <Link href={getDocumentLinkHref(link)}>
            <span className="font-mono text-[11px]">
              {getDocumentLinkDisplayCode(link)}
            </span>
            <span className="max-w-44 truncate">{link.title}</span>
          </Link>
        </Button>
      ))}
    </div>
  );
}

function LinkedDocumentSelector({
  errorKey,
  isLoading,
  onAddDocument,
  onQueryChange,
  onRemoveDocument,
  query,
  results,
  selectedDocuments,
}: {
  errorKey: string | null;
  isLoading: boolean;
  onAddDocument: (document: DocumentSummary) => void;
  onQueryChange: (query: string) => void;
  onRemoveDocument: (targetId: string) => void;
  query: string;
  results: DocumentSummary[];
  selectedDocuments: DocumentLinkSummary[];
}) {
  const t = useTranslations("documents");
  const tRoot = useTranslations();
  const hasQuery = query.trim().length > 0;

  return (
    <div className="grid gap-2 rounded-md border border-border bg-muted/30 p-3">
      <div className="grid gap-1.5">
        <span className="text-sm font-medium">{t("edit.documentsLabel")}</span>
        {selectedDocuments.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {selectedDocuments.map((linkedDocument) => (
              <Button
                key={linkedDocument.targetId}
                type="button"
                variant="secondary"
                size="sm"
                data-testid="document-linked-document-chip"
                onClick={() => onRemoveDocument(linkedDocument.targetId)}
                aria-label={t("edit.removeLinkedDocument", {
                  title: linkedDocument.title,
                })}
              >
                <FileText className="h-3.5 w-3.5" aria-hidden="true" />
                <span className="max-w-48 truncate">{linkedDocument.title}</span>
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </Button>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            {t("edit.noLinkedDocuments")}
          </p>
        )}
      </div>
      <label className="grid gap-1.5 text-sm">
        <span className="text-xs font-medium text-muted-foreground">
          {t("edit.documentsSearchLabel")}
        </span>
        <span className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            className="pl-9"
            data-testid="document-linked-document-search-input"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder={t("edit.documentsSearchPlaceholder")}
          />
        </span>
      </label>
      {isLoading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          {t("edit.documentsSearching")}
        </div>
      ) : null}
      {errorKey ? (
        <p className="text-xs text-destructive" role="alert">
          {tRoot(errorKey)}
        </p>
      ) : null}
      {hasQuery && !isLoading && !errorKey && results.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {t("edit.documentsNoResults")}
        </p>
      ) : null}
      {results.length > 0 ? (
        <div
          className="grid gap-1"
          data-testid="document-linked-document-results"
        >
          {results.map((result) => (
            <button
              key={result.id}
              type="button"
              className="flex min-h-10 items-center gap-2 rounded-md border border-border bg-background px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              data-testid="document-linked-document-result"
              onClick={() => onAddDocument(result)}
            >
              <Plus className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium text-foreground">
                  {result.title || t("untitled")}
                </span>
                {result.contentSnippet ? (
                  <span className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
                    {result.contentSnippet}
                  </span>
                ) : null}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function DocumentManagementSections({
  attachmentErrorKey,
  commentBody,
  commentErrorKey,
  document,
  isCommenting,
  isUploadingAttachment,
  locale,
  onAttachmentChange,
  onCommentBodyChange,
  onSubmitComment,
}: {
  attachmentErrorKey: string | null;
  commentBody: string;
  commentErrorKey: string | null;
  document: DocumentDetail;
  isCommenting: boolean;
  isUploadingAttachment: boolean;
  locale: string;
  onAttachmentChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onCommentBodyChange: (value: string) => void;
  onSubmitComment: () => void;
}) {
  const t = useTranslations("documents");
  const tRoot = useTranslations();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const comments = document.comments ?? [];
  const attachments = document.attachments ?? [];

  return (
    <div className="mt-8 grid gap-6 border-t border-border pt-6">
      <section
        id="document-comments"
        className="grid scroll-mt-20 gap-3"
        data-testid="document-comments-section"
      >
        <div className="flex items-center gap-2 text-sm font-semibold">
          <MessageSquare className="h-4 w-4 text-muted-foreground" />
          {t("comments.title")}
        </div>
        <div className="grid gap-2">
          <Textarea
            data-testid="document-comment-input"
            minLength={1}
            maxLength={8000}
            rows={3}
            value={commentBody}
            disabled={isCommenting}
            onChange={(event) => onCommentBodyChange(event.target.value)}
            placeholder={t("comments.placeholder")}
          />
          <div className="flex justify-end">
            <Button
              type="button"
              disabled={!commentBody.trim() || isCommenting}
              onClick={onSubmitComment}
              data-testid="document-comment-submit"
            >
              {isCommenting ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Send className="h-4 w-4" aria-hidden="true" />
              )}
              {t("comments.submit")}
            </Button>
          </div>
        </div>
        {commentErrorKey ? (
          <p className="text-sm text-destructive" role="alert">
            {tRoot(commentErrorKey)}
          </p>
        ) : null}
        {comments.length > 0 ? (
          <div className="grid gap-2">
            {comments.map((comment) => (
              <article
                key={comment.id}
                className="rounded-md border border-border bg-card px-3 py-2"
              >
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">
                    {comment.authorName ?? t("rail.unknownActor")}
                  </span>
                  <span>
                    {formatDocumentRelativeTimestamp(comment.createdAt, locale)}
                  </span>
                </div>
                <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">
                  {comment.body}
                </p>
              </article>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{t("comments.empty")}</p>
        )}
      </section>

      <section
        id="document-attachments"
        className="grid scroll-mt-20 gap-3"
        data-testid="document-attachments-section"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Paperclip className="h-4 w-4 text-muted-foreground" />
            {t("attachments.title")}
          </div>
          <input
            ref={fileInputRef}
            className="hidden"
            data-testid="document-attachment-input"
            type="file"
            disabled={isUploadingAttachment}
            onChange={onAttachmentChange}
          />
          <Button
            type="button"
            variant="outline"
            disabled={isUploadingAttachment}
            onClick={() => fileInputRef.current?.click()}
            data-testid="document-attachment-upload-button"
          >
            {isUploadingAttachment ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Upload className="h-4 w-4" aria-hidden="true" />
            )}
            {t("attachments.upload")}
          </Button>
        </div>
        {attachmentErrorKey ? (
          <p className="text-sm text-destructive" role="alert">
            {tRoot(attachmentErrorKey)}
          </p>
        ) : null}
        {attachments.length > 0 ? (
          <div className="divide-y divide-border rounded-md border border-border bg-card">
            {attachments.map((attachment) => (
              <div
                key={attachment.id}
                className="flex flex-wrap items-center justify-between gap-3 px-3 py-2"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-foreground">
                    {attachment.fileName}
                  </div>
                  {attachment.size ? (
                    <div className="text-xs text-muted-foreground">
                      {formatBytes(attachment.size)}
                    </div>
                  ) : null}
                </div>
                <Button asChild variant="ghost" size="sm">
                  <a
                    href={createAttachmentDownloadUrl(attachment.id)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <Download className="h-3.5 w-3.5" aria-hidden="true" />
                    {t("attachments.download")}
                  </a>
                </Button>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            {t("attachments.empty")}
          </p>
        )}
      </section>
    </div>
  );
}

function DocumentDeleteDialog({
  documentTitle,
  isDeleting,
  onConfirm,
  onOpenChange,
  open,
}: {
  documentTitle: string;
  isDeleting: boolean;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}) {
  const t = useTranslations("documents.deleteDialog");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="document-delete-dialog">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description", { title: documentTitle })}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={isDeleting}
            onClick={() => onOpenChange(false)}
          >
            {t("cancel")}
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={isDeleting}
            onClick={onConfirm}
            data-testid="document-delete-confirm"
          >
            {isDeleting ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Trash2 className="h-4 w-4" aria-hidden="true" />
            )}
            {t("confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DocumentContextRail({
  document,
  headings,
  locale,
}: {
  document: DocumentDetail;
  headings: MarkdownHeading[];
  locale: string;
}) {
  const t = useTranslations("documents");

  return (
    <aside className="min-w-0 lg:sticky lg:top-16 lg:max-h-[calc(100vh-5rem)] lg:overflow-y-auto">
      <div className="grid gap-4 rounded-md border border-border bg-card p-4" data-testid="document-context-rail">
        <RailSection icon={<FileText className="h-4 w-4" />} title={t("rail.toc")}>
          {headings.length > 0 ? (
            <nav className="grid gap-1">
              {headings.slice(0, 12).map((heading) => (
                <a
                  key={heading.id}
                  className={cn(
                    "truncate rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    heading.level > 2 && "pl-4",
                  )}
                  href={`#${heading.id}`}
                >
                  {heading.text}
                </a>
              ))}
            </nav>
          ) : (
            <p className="text-xs text-muted-foreground">{t("rail.noToc")}</p>
          )}
        </RailSection>
        <RailSection icon={<Link2 className="h-4 w-4" />} title={t("rail.resources")}>
          <DocumentLinksSummary links={document.links ?? []} />
        </RailSection>
        <RailSection icon={<Tags className="h-4 w-4" />} title={t("rail.tags")}>
          <TagBadgeList tags={document.tags ?? []} emptyLabel={t("rail.noTags")} />
        </RailSection>
        <RailSection icon={<MessageSquare className="h-4 w-4" />} title={t("rail.comments")}>
          <RailJumpLink
            count={(document.comments ?? []).length}
            emptyLabel={t("rail.noComments")}
            href="#document-comments"
            label={t("rail.viewAll", { count: (document.comments ?? []).length })}
          />
        </RailSection>
        <RailSection icon={<Paperclip className="h-4 w-4" />} title={t("rail.attachments")}>
          <RailJumpLink
            count={(document.attachments ?? []).length}
            emptyLabel={t("rail.noAttachments")}
            href="#document-attachments"
            label={t("rail.viewAll", { count: (document.attachments ?? []).length })}
          />
        </RailSection>
        <RailSection icon={<Clock3 className="h-4 w-4" />} title={t("rail.timeline")}>
          {(document.timeline ?? []).slice(0, 3).map((event) => (
            <div key={event.id} className="text-xs text-muted-foreground">
              <div className="text-foreground">{event.changeType}</div>
              <div>{formatDocumentRelativeTimestamp(event.createdAt, locale)}</div>
            </div>
          ))}
          {(document.timeline ?? []).length === 0 ? (
            <p className="text-xs text-muted-foreground">{t("rail.noTimeline")}</p>
          ) : null}
        </RailSection>
        <dl className="grid gap-2 border-t border-border pt-3 text-[11px] text-muted-foreground">
          <div>
            <dt className="font-medium text-foreground">{t("rail.created")}</dt>
            <dd>{formatDocumentCreatedMeta(document, locale, t)}</dd>
          </div>
          <div>
            <dt className="font-medium text-foreground">{t("rail.edited")}</dt>
            <dd>{formatDocumentEditedMeta(document, locale, t)}</dd>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <dt className="font-medium text-foreground">{t("rail.source")}</dt>
              <dd>{t(getDocumentSourceKey(document.sourceType))}</dd>
            </div>
            <div>
              <dt className="font-medium text-foreground">{t("rail.revision")}</dt>
              <dd>{document.revision}</dd>
            </div>
          </div>
        </dl>
      </div>
    </aside>
  );
}

function RailSection({
  children,
  icon,
  title,
}: {
  children: ReactNode;
  icon: ReactNode;
  title: string;
}) {
  return (
    <section className="grid gap-2">
      <h2 className="flex items-center gap-1.5 text-xs font-semibold uppercase text-muted-foreground">
        {icon}
        {title}
      </h2>
      {children}
    </section>
  );
}

function RailJumpLink({
  count,
  emptyLabel,
  href,
  label,
}: {
  count: number;
  emptyLabel: string;
  href: string;
  label: string;
}) {
  if (count === 0) {
    return <p className="text-xs text-muted-foreground">{emptyLabel}</p>;
  }

  return (
    <a
      href={href}
      className="flex items-center justify-between gap-2 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="truncate">{label}</span>
      <ChevronRight className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
    </a>
  );
}

async function getDocumentWithSubresources(input: {
  documentId: string;
  organizationId?: string;
  spaceId?: string;
}): Promise<DocumentDetail> {
  const document = await getDocument(input);
  const [comments, attachments, timeline] = await Promise.allSettled([
    listComments({
      organizationId: document.organizationId,
      page: 1,
      pageSize: 20,
      spaceId: document.spaceId,
      targetId: document.id,
      targetType: "DOCUMENT",
    }),
    listAttachments({
      organizationId: document.organizationId,
      page: 1,
      pageSize: 20,
      spaceId: document.spaceId,
      targetId: document.id,
      targetType: "DOCUMENT",
    }),
    listTimeline({
      organizationId: document.organizationId,
      page: 1,
      pageSize: 20,
      spaceId: document.spaceId,
      targetId: document.id,
      targetType: "DOCUMENT",
    }),
  ] as const);

  return {
    ...document,
    attachments:
      attachments.status === "fulfilled"
        ? attachments.value.items.map(toDocumentAttachmentSummary)
        : document.attachments,
    comments:
      comments.status === "fulfilled"
        ? comments.value.items.map(toDocumentCommentSummary)
        : document.comments,
    timeline:
      timeline.status === "fulfilled"
        ? timeline.value.items.map(toDocumentTimelineSummary)
        : document.timeline,
  };
}

function toDocumentAttachmentSummary(attachment: Attachment) {
  return {
    fileName: attachment.fileName,
    id: attachment.id,
    size: attachment.size,
  };
}

function toDocumentCommentSummary(comment: Comment) {
  return {
    authorName: comment.author.name || comment.author.username,
    body: comment.body,
    createdAt: comment.createdAt,
    id: comment.id,
  };
}

function toDocumentTimelineSummary(event: TimelineEvent) {
  return {
    actorName: event.actor.name || event.actor.username,
    changeType: event.title || event.eventType,
    createdAt: event.createdAt,
    id: event.id,
  };
}

async function resolveLinkTargets({
  codes,
  organizationId,
  spaceId,
}: {
  codes: string[];
  organizationId: string;
  spaceId: string;
}) {
  const targets = [];
  for (const code of codes) {
    const result = await lookupObjectCode({ code, organizationId, spaceId });
    targets.push({
      targetId: result.id,
      targetType: getLookupTargetType(result),
    });
  }
  return targets;
}

function dedupeLinkTargets(
  targets: Array<{ targetId: string; targetType: DocumentLinkSummary["targetType"] }>,
) {
  const seen = new Set<string>();
  return targets.filter((target) => {
    const key = `${target.targetType}:${target.targetId}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function toDocumentLinkSummary(document: DocumentSummary): DocumentLinkSummary {
  return {
    id: `document:${document.id}`,
    targetId: document.id,
    targetType: "DOCUMENT",
    title: document.title || document.id,
  };
}

function formatBytes(value: number): string {
  if (value < 1024) {
    return `${value} B`;
  }
  if (value < 1024 * 1024) {
    return `${Math.round(value / 102.4) / 10} KB`;
  }
  return `${Math.round(value / 1024 / 102.4) / 10} MB`;
}

function isConflictError(error: unknown): boolean {
  return error instanceof ApiClientError && error.status === 409;
}
