"use client";

import {
  Archive,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Download,
  Eye,
  ExternalLink,
  FileCheck2,
  FileText,
  FileX2,
  FolderInput,
  Info,
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
import { useSearchParams } from "next/navigation";
import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type ReactNode,
} from "react";
import type {
  Attachment,
  Comment,
  SpaceRole,
  TimelineEvent,
} from "@project-delivery/shared";

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
  DocumentFolder,
  DocumentLinkSummary,
  DocumentLinkWriteTargetType,
  DocumentSummary,
} from "../../lib/document-service";
import {
  archiveDocument,
  cancelRequirement as cancelRequirementDocument,
  convertDocumentToRequirement,
  deleteDocument,
  getCancelRequirementPreflight,
  getDocument,
  listDocumentFolders,
  listDocuments,
  moveDocumentToFolder,
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
  canRenderDocumentMarkdownContent,
  formatDocumentRelativeTimestamp,
  getDocumentDisplayCode,
  getDocumentLinkDisplayCode,
  getDocumentLinkHref,
  getDocumentSourceKey,
  getLookupTargetType,
  isRequirementDocument,
  isRequirementDocumentLink,
} from "../../lib/document-view-model";
import { lookupObjectCode } from "../../lib/object-code-service";
import {
  realtimeContextIncludesTarget,
  useRealtimeInvalidation,
} from "../../lib/realtime";
import { createTiptapDocumentFromText } from "../../lib/requirement-editor-content";
import { useFocusedListItem } from "../../lib/hooks/use-focused-list-item";
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
import { SelectMenu } from "../ui/select-menu";
import { Textarea } from "../ui/textarea";
import { Tip } from "../ui/tooltip";
import { useDocumentDirectory } from "./document-directory-context";
import {
  createDocumentDirectoryHref,
  flattenDocumentFolders,
  normalizeDocumentFolderTree,
} from "./document-directory-model";
import {
  ActorBadge,
  DocumentLinksSummary,
  DOCUMENTS_LAST_LIST_HREF_STORAGE_KEY,
  SourceBadge,
  formatDocumentCreatedMeta,
  formatDocumentEditedMeta,
} from "./documents-page";
import {
  DocumentMarkdownViewer,
  getDocumentMarkdownHeadings,
  type MarkdownHeading,
} from "./document-markdown-viewer";
import { ReferencingDocumentsSection } from "./referencing-documents-section";

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
const DOCUMENT_ATTACHMENT_LIST_PAGE_SIZE = 200;
const DOCUMENT_ATTACHMENT_VISIBLE_LIMIT = 5;
const REQUIREMENT_WRITER_ROLES = new Set<SpaceRole>([
  "SPACE_ADMIN",
  "PM",
  "REQUIREMENT",
]);
const REQUIREMENT_MANAGER_ROLES = new Set<SpaceRole>(["SPACE_ADMIN", "PM"]);

function isValidDocumentListHref(href: string | null): href is string {
  return href === "/documents" || href?.startsWith("/documents?") === true;
}

function readStoredDocumentListHref(): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const href = window.sessionStorage.getItem(
      DOCUMENTS_LAST_LIST_HREF_STORAGE_KEY,
    );
    return isValidDocumentListHref(href) ? href : null;
  } catch {
    return null;
  }
}

function getDocumentBackToListFallbackHref(document: DocumentDetail | null) {
  if (document?.folderId) {
    return createDocumentDirectoryHref({
      folderId: document.folderId,
      view: "folder",
    });
  }
  if (document?.status === "ARCHIVED") {
    return createDocumentDirectoryHref({ view: "archived" });
  }
  return "/documents";
}

function canConvertDocumentToRequirement(
  document: DocumentDetail,
  role: SpaceRole | undefined,
) {
  return (
    document.kind === "GENERAL" &&
    document.status !== "ARCHIVED" &&
    Boolean(role && REQUIREMENT_WRITER_ROLES.has(role))
  );
}

function canCancelRequirementDocument(
  document: DocumentDetail,
  role: SpaceRole | undefined,
  userId: string | undefined,
) {
  if (document.kind !== "REQUIREMENT" || !role) {
    return false;
  }
  if (document.status === "DRAFT" && document.sequence == null) {
    return (
      REQUIREMENT_WRITER_ROLES.has(role) ||
      (Boolean(userId) && document.createdById === userId)
    );
  }
  return REQUIREMENT_MANAGER_ROLES.has(role);
}

function normalizeSearchParam(value: string | null): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function DocumentDetailPage({ documentId }: DocumentDetailPageProps) {
  const t = useTranslations("documents");
  const tRoot = useTranslations();
  const locale = useLocale();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { currentOrganization, currentSpace, session, status } = useSession();
  const { setActiveDocumentFolderId } = useDocumentDirectory();
  const organizationId =
    currentOrganization?.id ?? session?.defaultOrganizationId;
  const focusedCommentId = normalizeSearchParam(searchParams.get("commentId"));
  const focusedAttachmentId = normalizeSearchParam(
    searchParams.get("attachmentId"),
  );
  const [document, setDocument] = useState<DocumentDetail | null>(null);
  const [form, setForm] = useState<DocumentEditForm | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isArchiving, setIsArchiving] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isConvertingToRequirement, setIsConvertingToRequirement] =
    useState(false);
  const [isCancellingRequirement, setIsCancellingRequirement] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [cancelRequirementDialogOpen, setCancelRequirementDialogOpen] =
    useState(false);
  const [cancelRequirementReferenceMode, setCancelRequirementReferenceMode] =
    useState<"REJECT_IF_REFERENCED" | "UNLINK_REFERENCES">(
      "REJECT_IF_REFERENCED",
    );
  const [cancelRequirementReferenceCount, setCancelRequirementReferenceCount] =
    useState<number | null>(null);
  const [cancelRequirementReason, setCancelRequirementReason] = useState("");
  const [
    isLoadingCancelRequirementPreflight,
    setIsLoadingCancelRequirementPreflight,
  ] = useState(false);
  const [moveFolderDialogOpen, setMoveFolderDialogOpen] = useState(false);
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
  const spaceId =
    document?.spaceId ?? currentSpace?.id ?? session?.defaultSpaceId;
  const [storedListHref, setStoredListHref] = useState<string | null>(null);
  const backToListHref = useMemo(
    () => storedListHref ?? getDocumentBackToListFallbackHref(document),
    [document, storedListHref],
  );
  const canRenderMarkdownContent = document
    ? canRenderDocumentMarkdownContent(document)
    : true;
  const canEditTiptapContent =
    document?.kind === "GENERAL" && document.contentFormat === "TIPTAP_JSON";
  const isRequirement = document ? isRequirementDocument(document) : false;
  const canEditDocumentContent =
    !isRequirement && (canRenderMarkdownContent || canEditTiptapContent);
  const documentDisplayCode = document
    ? getDocumentDisplayCode(document)
    : null;
  const showContentEditMode = editMode && canEditDocumentContent;
  const currentSpaceRole = currentSpace?.role;
  const currentUserId = session?.user.id;
  const canConvertDocument = document
    ? canConvertDocumentToRequirement(document, currentSpaceRole)
    : false;
  const canCancelRequirement = document
    ? canCancelRequirementDocument(document, currentSpaceRole, currentUserId)
    : false;

  useEffect(() => {
    setStoredListHref(readStoredDocumentListHref());
  }, [documentId]);

  useEffect(() => {
    if (document && !canEditDocumentContent) {
      setEditMode(false);
      setContentPreview(false);
    }
  }, [canEditDocumentContent, document]);

  useEffect(() => {
    setActiveDocumentFolderId(document?.folderId);
    return () => setActiveDocumentFolderId(undefined);
  }, [document?.folderId, setActiveDocumentFolderId]);

  useEffect(() => {
    formRef.current = form;
  }, [form]);

  useEffect(() => {
    editModeRef.current = editMode;
  }, [editMode]);

  const documentLabel = tRoot("shell.command.documentLabel");
  const untitledLabel = t("untitled");
  const loadDocument = useCallback(
    async (options?: { realtime?: boolean; preserveForm?: boolean }) => {
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
          focusedAttachmentId,
          focusedCommentId,
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
              displayCode: documentLabel,
              href: `/documents/${next.id}`,
              id: next.id,
              organizationId: next.organizationId,
              spaceId: next.spaceId,
              title: next.title || untitledLabel,
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
    },
    [
      documentId,
      focusedAttachmentId,
      focusedCommentId,
      organizationId,
      spaceId,
      documentLabel,
      untitledLabel,
    ],
  );

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
            (item) =>
              item.id !== document.id && !selectedDocumentIds.has(item.id),
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
    editMode && form
      ? canRenderMarkdownContent
        ? form.contentMarkdown
        : form.contentText
      : canRenderMarkdownContent
        ? (document?.contentMarkdown ?? "")
        : (document?.contentMarkdownCache ?? document?.contentText ?? "");
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
      const linkedDocumentTargets = form.linkedDocuments
        .filter((link) => !isRequirementDocumentLink(link))
        .map((link) => ({
          targetId: link.targetId,
          targetType: "DOCUMENT" as const,
        }));
      const contentMarkdown =
        canRenderDocumentMarkdownContent(document) &&
        form.contentMarkdown !== document.contentMarkdown
          ? form.contentMarkdown
          : undefined;
      const contentText =
        canEditTiptapContent &&
        form.contentText !==
          (document.contentMarkdownCache ?? document.contentText ?? "")
          ? form.contentText
          : undefined;
      const next = await updateDocument({
        baseRevision: form.baseRevision,
        ...(contentMarkdown !== undefined ? { contentMarkdown } : {}),
        ...(contentText !== undefined
          ? {
              contentFormat: "TIPTAP_JSON" as const,
              contentJson: createTiptapDocumentFromText(contentText),
              contentMarkdownCache: contentText,
              contentText,
            }
          : {}),
        documentId: document.id,
        linkTargets: dedupeLinkTargets([
          ...linkedDocumentTargets,
          ...linkTargets,
        ]),
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

  const convertCurrentDocumentToRequirement = async () => {
    if (!document || !canConvertDocument) {
      return;
    }

    setIsConvertingToRequirement(true);
    setErrorKey(null);
    try {
      const next = await convertDocumentToRequirement({
        activate: true,
        baseRevision: document.revision,
        documentId: document.id,
        title: document.title,
      });
      setDocument(next);
      setForm(createDocumentEditForm(next));
      setHasRealtimeRevision(false);
      router.push(`/requirements/${next.id}`);
    } catch (error) {
      setErrorKey(getApiErrorMessageKey(error));
    } finally {
      setIsConvertingToRequirement(false);
    }
  };

  const openCancelRequirementDialog = async () => {
    if (!document || !canCancelRequirement) {
      return;
    }

    setCancelRequirementDialogOpen(true);
    setCancelRequirementReason("");
    setCancelRequirementReferenceCount(null);
    setCancelRequirementReferenceMode("REJECT_IF_REFERENCED");
    setIsLoadingCancelRequirementPreflight(true);
    setErrorKey(null);
    try {
      const preflight = await getCancelRequirementPreflight({
        documentId: document.id,
      });
      setCancelRequirementReferenceCount(preflight.referenceCount);
      setCancelRequirementReferenceMode(
        preflight.modeRequired ?? "REJECT_IF_REFERENCED",
      );
    } catch (error) {
      setErrorKey(getApiErrorMessageKey(error));
      setCancelRequirementDialogOpen(false);
    } finally {
      setIsLoadingCancelRequirementPreflight(false);
    }
  };

  const cancelCurrentRequirement = async () => {
    if (!document || !canCancelRequirement) {
      return;
    }

    setIsCancellingRequirement(true);
    setErrorKey(null);
    try {
      const next = await cancelRequirementDocument({
        baseRevision: document.revision,
        documentId: document.id,
        reason: cancelRequirementReason.trim() || undefined,
        referenceMode: cancelRequirementReferenceMode,
      });
      setDocument(next);
      setForm(createDocumentEditForm(next));
      setHasRealtimeRevision(false);
      setCancelRequirementDialogOpen(false);
      setCancelRequirementReason("");
    } catch (error) {
      setErrorKey(getApiErrorMessageKey(error));
    } finally {
      setIsCancellingRequirement(false);
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

  const uploadDocumentAttachment = async (
    event: ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0] ?? null;
    event.target.value = "";
    if (!document || !file) {
      return;
    }

    setIsUploadingAttachment(true);
    setAttachmentErrorKey(null);
    try {
      await uploadAttachment({
        existingAttachmentCount:
          document.attachmentTotal ?? document.attachments?.length ?? 0,
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
        current.linkedDocuments.some(
          (link) => link.targetId === linkedDocument.id,
        )
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
      <div className="mx-auto grid w-full max-w-[88rem] gap-4 px-3 py-4 sm:gap-6 sm:px-4 sm:py-5 lg:grid-cols-[12rem_minmax(0,1fr)] lg:px-6 xl:grid-cols-[13rem_minmax(0,1fr)_18rem]">
        <DocumentTocRail headings={headings} />
        <div className="min-w-0 max-w-[52rem]">
          <div
            className="sticky top-12 z-20 mb-3 bg-background/80 py-1.5 backdrop-blur-md supports-[backdrop-filter]:bg-background/70"
            data-testid="document-back-to-list-bar"
          >
            <Button
              asChild
              size="sm"
              variant="ghost"
              className="-ml-2 text-muted-foreground hover:text-foreground"
            >
              <Link href={backToListHref} data-testid="document-back-to-list">
                <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                {t("actions.backToList")}
              </Link>
            </Button>
          </div>
          <form onSubmit={(event) => void save(event)}>
            <div className="mb-3 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
              <Link className="hover:text-foreground hover:underline" href="/">
                {currentOrganization?.name ?? t("unknownOrganization")}
              </Link>
              <ChevronRight className="h-3 w-3 opacity-50" aria-hidden="true" />
              <Link
                className="hover:text-foreground hover:underline"
                href="/documents"
              >
                {currentSpace?.name ?? t("unknownSpace")}
              </Link>
              <ChevronRight className="h-3 w-3 opacity-50" aria-hidden="true" />
              <span className="text-foreground/80">{t("title")}</span>
            </div>

            <section className="pb-5">
              <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                <div className="min-w-0 flex-1">
                  {showContentEditMode ? (
                    <Input
                      aria-label={t("edit.titleLabel")}
                      className="h-auto border-0 px-0 py-1 text-2xl font-semibold tracking-tight shadow-none focus-visible:ring-0 md:text-3xl"
                      data-testid="document-title-input"
                      value={form.title}
                      onChange={(event) =>
                        setForm((current) =>
                          current
                            ? { ...current, title: event.target.value }
                            : current,
                        )
                      }
                    />
                  ) : (
                    <h1 className="break-words text-2xl font-semibold tracking-tight text-foreground md:text-3xl">
                      {document.title || t("untitled")}
                    </h1>
                  )}
                  <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
                    {document.status === "ARCHIVED" ? (
                      <span className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                        <Archive className="h-3 w-3" aria-hidden="true" />
                        {t("status.ARCHIVED")}
                      </span>
                    ) : null}
                    <SourceBadge sourceType={document.sourceType} />
                    <ActorBadge
                      actorType={document.lastEditedVia}
                      mcpClientName={document.lastEditedMcpClientName}
                    />
                    {isRequirement ? (
                      <RequirementIdentityBadge
                        displayCode={documentDisplayCode}
                        status={document.status}
                      />
                    ) : null}
                    <span
                      aria-hidden="true"
                      className="hidden h-3 w-px bg-border/60 sm:block"
                    />
                    <span className="min-w-0 max-w-full truncate">
                      {formatDocumentCreatedMeta(document, locale, t)}
                    </span>
                    <span
                      aria-hidden="true"
                      className="hidden h-3 w-px bg-border/60 sm:block"
                    />
                    <span className="min-w-0 max-w-full truncate">
                      {formatDocumentEditedMeta(document, locale, t)}
                    </span>
                  </div>
                </div>
                <div
                  className="flex w-full shrink-0 flex-wrap gap-2 sm:w-auto sm:justify-end [&>*]:w-full sm:[&>*]:w-auto"
                  data-testid="document-detail-actions"
                >
                  {showContentEditMode ? (
                    <Fragment key="document-edit-actions">
                      <Button
                        key="document-cancel-button"
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
                      <Button
                        key="document-save-button"
                        type="submit"
                        disabled={isSaving}
                        data-testid="document-save-button"
                      >
                        {isSaving ? (
                          <Loader2
                            className="h-4 w-4 animate-spin"
                            aria-hidden="true"
                          />
                        ) : (
                          <Save className="h-4 w-4" aria-hidden="true" />
                        )}
                        {t("actions.save")}
                      </Button>
                    </Fragment>
                  ) : (
                    <Fragment key="document-view-actions">
                      <Button
                        key="document-move-folder-button"
                        type="button"
                        variant="outline"
                        onClick={() => setMoveFolderDialogOpen(true)}
                        data-testid="document-move-folder-button"
                      >
                        <FolderInput className="h-4 w-4" aria-hidden="true" />
                        {t("actions.moveToFolder")}
                      </Button>
                      {canConvertDocument ? (
                        <Button
                          key="document-convert-requirement-button"
                          type="button"
                          variant="outline"
                          disabled={isConvertingToRequirement}
                          onClick={() =>
                            void convertCurrentDocumentToRequirement()
                          }
                          data-testid="document-convert-requirement-button"
                        >
                          {isConvertingToRequirement ? (
                            <Loader2
                              className="h-4 w-4 animate-spin"
                              aria-hidden="true"
                            />
                          ) : (
                            <FileCheck2
                              className="h-4 w-4"
                              aria-hidden="true"
                            />
                          )}
                          {t("actions.convertToRequirement")}
                        </Button>
                      ) : null}
                      {canEditDocumentContent ? (
                        <Button
                          key="document-edit-button"
                          type="button"
                          variant="outline"
                          onClick={(event) => {
                            event.preventDefault();
                            setContentPreview(false);
                            setEditMode(true);
                          }}
                          data-testid="document-edit-button"
                        >
                          <Pencil className="h-4 w-4" aria-hidden="true" />
                          {t("actions.edit")}
                        </Button>
                      ) : null}
                      {isRequirement ? (
                        <>
                          <Button
                            asChild
                            key="document-open-requirement-button"
                            variant="outline"
                            data-testid="document-open-requirement-button"
                          >
                            <Link href={`/requirements/${document.id}`}>
                              <ExternalLink
                                className="h-4 w-4"
                                aria-hidden="true"
                              />
                              {t("actions.openRequirementView")}
                            </Link>
                          </Button>
                          {canCancelRequirement ? (
                            <Button
                              key="document-cancel-requirement-button"
                              type="button"
                              variant="outline"
                              disabled={
                                isLoadingCancelRequirementPreflight ||
                                isCancellingRequirement
                              }
                              onClick={() => void openCancelRequirementDialog()}
                              data-testid="document-cancel-requirement-button"
                            >
                              {isLoadingCancelRequirementPreflight ||
                              isCancellingRequirement ? (
                                <Loader2
                                  className="h-4 w-4 animate-spin"
                                  aria-hidden="true"
                                />
                              ) : (
                                <FileX2
                                  className="h-4 w-4"
                                  aria-hidden="true"
                                />
                              )}
                              {t("actions.cancelRequirement")}
                            </Button>
                          ) : null}
                        </>
                      ) : null}
                      {!isRequirement && document.status === "ARCHIVED" ? (
                        <>
                          <Button
                            key="document-restore-button"
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
                              <RotateCcw
                                className="h-4 w-4"
                                aria-hidden="true"
                              />
                            )}
                            {t("actions.restore")}
                          </Button>
                          <Button
                            key="document-delete-button"
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
                      ) : !isRequirement ? (
                        <Button
                          key="document-archive-button"
                          type="button"
                          variant="ghost"
                          disabled={isArchiving}
                          onClick={() => void archive()}
                          data-testid="document-archive-button"
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
                      ) : null}
                    </Fragment>
                  )}
                </div>
              </div>

              <LinkedResourceChips links={document.links ?? []} />
            </section>

            {hasRealtimeRevision ? (
              <div
                role="status"
                className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-warning/10 px-4 py-2.5 text-sm text-warning"
                data-testid="document-new-version-alert"
              >
                <span>{t("detail.newVersion")}</span>
                <Button
                  size="sm"
                  type="button"
                  variant="ghost"
                  className="text-warning hover:bg-warning/15 hover:text-warning"
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
                className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-warning/10 px-4 py-2.5 text-sm text-warning"
                data-testid="document-conflict-alert"
              >
                <span>{t("detail.conflict")}</span>
                <Button
                  size="sm"
                  type="button"
                  variant="ghost"
                  className="text-warning hover:bg-warning/15 hover:text-warning"
                  onClick={() => void loadDocument()}
                >
                  <RefreshCw className="h-4 w-4" aria-hidden="true" />
                  {t("actions.refresh")}
                </Button>
              </div>
            ) : null}

            {errorKey ? (
              <div
                role="alert"
                className="mt-4 rounded-lg bg-destructive/10 px-4 py-2.5 text-sm text-destructive"
              >
                {tRoot(errorKey)}
              </div>
            ) : null}

            {showContentEditMode ? (
              <section
                className="mt-5 grid gap-5"
                data-testid="document-edit-panel"
              >
                <div className="grid gap-2 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium" id="document-content-label">
                      {t("edit.contentLabel")}
                    </span>
                    <div
                      className="inline-flex items-center rounded-md bg-muted/50 p-0.5"
                      role="group"
                      aria-label={t("edit.contentViewLabel")}
                    >
                      {([false, true] as const).map((preview) => (
                        <button
                          key={preview ? "preview" : "source"}
                          type="button"
                          aria-pressed={contentPreview === preview}
                          className={cn(
                            "inline-flex h-6 items-center rounded px-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                            contentPreview === preview
                              ? "bg-background text-foreground shadow-sm"
                              : "text-muted-foreground hover:text-foreground",
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
                      className="min-h-[28rem] rounded-lg bg-muted/30 p-4"
                      markdown={
                        canRenderMarkdownContent
                          ? form.contentMarkdown
                          : form.contentText
                      }
                      organizationId={document.organizationId}
                      spaceId={document.spaceId}
                    />
                  ) : (
                    <Textarea
                      aria-labelledby="document-content-label"
                      className="min-h-[28rem] font-mono text-xs leading-5"
                      data-testid="document-content-input"
                      value={
                        canRenderMarkdownContent
                          ? form.contentMarkdown
                          : form.contentText
                      }
                      onChange={(event) =>
                        setForm((current) =>
                          current
                            ? canRenderMarkdownContent
                              ? {
                                  ...current,
                                  contentMarkdown: event.target.value,
                                }
                              : {
                                  ...current,
                                  contentText: event.target.value,
                                }
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
                          current
                            ? { ...current, selectedTags: tags }
                            : current,
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
                          ? {
                              ...current,
                              linkedResourceCodes: event.target.value,
                            }
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
                {canRenderMarkdownContent ? (
                  <div className="grid gap-2 rounded-lg bg-muted/40 p-3">
                    <label className="grid gap-1.5 text-sm">
                      <span className="font-medium">
                        {t("edit.reimportLabel")}
                      </span>
                      <Input
                        accept=".md,.markdown,.docx,.html,.htm,.zip"
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
                        disabled={
                          !reimportFile ||
                          !getImportKind(reimportFile) ||
                          isSaving
                        }
                        onClick={() => void reimport()}
                      >
                        <RefreshCw className="h-4 w-4" aria-hidden="true" />
                        {t("actions.reimport")}
                      </Button>
                    </div>
                  </div>
                ) : null}
              </section>
            ) : (
              <DocumentContentReadView document={document} />
            )}
          </form>

          <DocumentManagementSections
            attachmentErrorKey={attachmentErrorKey}
            commentBody={commentBody}
            commentErrorKey={commentErrorKey}
            document={document}
            focusedAttachmentId={focusedAttachmentId}
            focusedCommentId={focusedCommentId}
            isCommenting={isCommenting}
            isUploadingAttachment={isUploadingAttachment}
            locale={locale}
            onAttachmentChange={(event) => void uploadDocumentAttachment(event)}
            onCommentBodyChange={setCommentBody}
            onSubmitComment={() => void submitComment()}
          />
        </div>

        <DocumentContextRail document={document} locale={locale} />
      </div>
      <DocumentDeleteDialog
        documentTitle={document.title || t("untitled")}
        isDeleting={isDeleting}
        onConfirm={() => void remove()}
        onOpenChange={setDeleteDialogOpen}
        open={deleteDialogOpen}
      />
      <RequirementCancelDialog
        isCancelling={isCancellingRequirement}
        isLoading={isLoadingCancelRequirementPreflight}
        onConfirm={() => void cancelCurrentRequirement()}
        onOpenChange={setCancelRequirementDialogOpen}
        onReasonChange={setCancelRequirementReason}
        onReferenceModeChange={setCancelRequirementReferenceMode}
        open={cancelRequirementDialogOpen}
        reason={cancelRequirementReason}
        referenceCount={cancelRequirementReferenceCount}
        referenceMode={cancelRequirementReferenceMode}
      />
      <DocumentMoveFolderDialog
        baseRevision={document.revision}
        currentFolderId={document.folderId ?? null}
        documentId={document.id}
        onMoved={(next) => {
          setDocument(next);
          setForm(createDocumentEditForm(next));
          setActiveDocumentFolderId(next.folderId);
          setHasRealtimeRevision(false);
        }}
        onOpenChange={setMoveFolderDialogOpen}
        open={moveFolderDialogOpen}
        organizationId={document.organizationId}
        spaceId={document.spaceId}
      />
    </>
  );
}

function RequirementIdentityBadge({
  displayCode,
  status,
}: {
  displayCode: string | null;
  status: DocumentDetail["status"];
}) {
  const t = useTranslations("documents");
  return (
    <Badge
      variant="outline"
      className="border-primary/30 bg-primary/10 text-primary"
      data-testid="document-requirement-identity"
    >
      <span className="font-mono">{displayCode ?? t("kind.REQUIREMENT")}</span>
      <span className="text-primary/70">{t(`status.${status}`)}</span>
    </Badge>
  );
}

function DocumentContentReadView({ document }: { document: DocumentDetail }) {
  if (canRenderDocumentMarkdownContent(document)) {
    return (
      <DocumentMarkdownViewer
        className="mt-6"
        markdown={document.contentMarkdown}
        organizationId={document.organizationId}
        spaceId={document.spaceId}
      />
    );
  }

  if (document.contentFormat === "TIPTAP_JSON") {
    return (
      <DocumentMarkdownViewer
        className="mt-6"
        markdown={document.contentMarkdownCache ?? document.contentText ?? ""}
        organizationId={document.organizationId}
        spaceId={document.spaceId}
      />
    );
  }

  return <ManagedDocumentContentPanel document={document} />;
}

function ManagedDocumentContentPanel({
  document,
}: {
  document: DocumentDetail;
}) {
  const t = useTranslations("documents");
  const preview = getManagedContentPreview(document);
  const isRequirement = isRequirementDocument(document);
  const displayCode = getDocumentDisplayCode(document);

  return (
    <section
      className="mt-6 grid gap-3 rounded-lg border border-border bg-muted/30 p-4"
      data-testid="document-managed-content-panel"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Badge
          variant={isRequirement ? "default" : "outline"}
          data-testid="document-managed-content-kind"
        >
          {isRequirement
            ? t("kind.REQUIREMENT")
            : t(`contentFormat.${document.contentFormat}`)}
        </Badge>
        {displayCode ? (
          <span
            className="rounded bg-background px-1.5 py-0.5 font-mono text-xs text-foreground"
            data-testid="document-managed-content-code"
          >
            {displayCode}
          </span>
        ) : null}
      </div>
      <p className="text-sm text-muted-foreground">
        {isRequirement
          ? t("detail.requirementManaged")
          : t("detail.richTextReadOnly")}
      </p>
      {preview ? (
        <pre
          className="max-h-[28rem] overflow-auto whitespace-pre-wrap rounded-md bg-background px-3 py-2 font-mono text-xs leading-5 text-foreground"
          data-testid="document-managed-content-preview"
        >
          {preview}
        </pre>
      ) : (
        <p className="rounded-md bg-background px-3 py-2 text-sm text-muted-foreground">
          {t("detail.noManagedPreview")}
        </p>
      )}
    </section>
  );
}

function getManagedContentPreview(document: DocumentDetail): string {
  if (document.contentFormat === "TIPTAP_JSON") {
    return (
      document.contentMarkdownCache?.trim() ||
      document.contentText?.trim() ||
      document.summary?.trim() ||
      ""
    );
  }

  return document.contentMarkdown.trim() || document.summary?.trim() || "";
}

function LinkedResourceChips({
  links,
}: {
  links: NonNullable<DocumentDetail["links"]>;
}) {
  const t = useTranslations("documents");
  if (links.length === 0) {
    return (
      <p className="mt-4 text-sm text-muted-foreground">
        {t("detail.noLinks")}
      </p>
    );
  }

  return (
    <div
      className="mt-4 flex flex-wrap gap-1.5"
      data-testid="document-linked-resources"
    >
      {links.map((link) => (
        <Link
          key={link.id}
          href={getDocumentLinkHref(link)}
          className="inline-flex max-w-full items-center gap-1.5 rounded-md bg-muted px-2 py-1 text-xs text-foreground/80 transition-colors hover:bg-muted/70 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="font-mono text-[11px] text-foreground">
            {getDocumentLinkDisplayCode(link)}
          </span>
          <span className="max-w-44 truncate">{link.title}</span>
        </Link>
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
    <div className="grid gap-2 rounded-lg bg-muted/40 p-3">
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
                <span className="max-w-48 truncate">
                  {linkedDocument.title}
                </span>
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
              className="flex min-h-10 items-center gap-2 rounded-md bg-background px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
  focusedAttachmentId,
  focusedCommentId,
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
  focusedAttachmentId?: string;
  focusedCommentId?: string;
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
  const [showAllAttachments, setShowAllAttachments] = useState(false);
  const shouldCollapseAttachments =
    attachments.length > DOCUMENT_ATTACHMENT_VISIBLE_LIMIT;
  const visibleAttachments =
    shouldCollapseAttachments && !showAllAttachments
      ? attachments.slice(0, DOCUMENT_ATTACHMENT_VISIBLE_LIMIT)
      : attachments;
  const { highlightedId: highlightedCommentId, registerItem: registerComment } =
    useFocusedListItem<HTMLElement>({
      focusedId: focusedCommentId,
      resetKey: document.id,
    });
  const {
    highlightedId: highlightedAttachmentId,
    registerItem: registerAttachment,
  } = useFocusedListItem<HTMLLIElement>({
    focusedId: focusedAttachmentId,
    resetKey: document.id,
  });

  useEffect(() => {
    setShowAllAttachments(false);
  }, [document.id]);

  useEffect(() => {
    if (
      focusedAttachmentId &&
      attachments.some((attachment) => attachment.id === focusedAttachmentId)
    ) {
      setShowAllAttachments(true);
    }
  }, [attachments, focusedAttachmentId]);

  return (
    <div className="mt-10 grid gap-8">
      <section
        id="document-comments"
        className="grid scroll-mt-20 gap-3"
        data-testid="document-comments-section"
      >
        <div className="flex items-baseline gap-2">
          <MessageSquare className="h-3.5 w-3.5 self-center text-muted-foreground" />
          <span className="text-sm font-semibold">{t("comments.title")}</span>
          {comments.length > 0 ? (
            <span className="text-[11px] tabular-nums text-muted-foreground/70">
              {comments.length}
            </span>
          ) : null}
        </div>
        <div className="grid gap-2 rounded-lg bg-muted/40 p-3">
          <Textarea
            className="border-0 bg-background shadow-sm focus-visible:ring-1"
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
              size="sm"
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
          <div className="grid gap-1.5">
            {comments.map((comment) => (
              <article
                key={comment.id}
                id={`comment-${comment.id}`}
                ref={registerComment(comment.id)}
                data-comment-id={comment.id}
                className={cn(
                  "rounded-lg px-3 py-2 transition-colors hover:bg-muted/30",
                  highlightedCommentId === comment.id &&
                    "bg-primary/5 ring-2 ring-primary/30 ring-offset-2 ring-offset-background",
                )}
              >
                <div className="flex flex-wrap items-baseline gap-2 text-xs text-muted-foreground">
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
          <div className="flex items-baseline gap-2">
            <Paperclip className="h-3.5 w-3.5 self-center text-muted-foreground" />
            <span className="text-sm font-semibold">
              {t("attachments.title")}
            </span>
            {attachments.length > 0 ? (
              <span className="text-[11px] tabular-nums text-muted-foreground/70">
                {attachments.length}
              </span>
            ) : null}
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
            size="sm"
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
          <ul className="grid gap-0.5">
            {visibleAttachments.map((attachment) => {
              const downloadUrl = createAttachmentDownloadUrl(attachment.id);
              const canPreview = canPreviewDocumentAttachment(attachment);

              return (
                <li
                  key={attachment.id}
                  id={`attachment-${attachment.id}`}
                  ref={registerAttachment(attachment.id)}
                  data-attachment-id={attachment.id}
                  className={cn(
                    "flex flex-wrap items-center justify-between gap-3 rounded-lg px-3 py-2 transition-colors hover:bg-muted/40",
                    highlightedAttachmentId === attachment.id &&
                      "bg-primary/5 ring-2 ring-primary/30 ring-offset-2 ring-offset-background",
                  )}
                >
                  <div className="flex min-w-0 items-center gap-2.5">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                      <Paperclip className="h-3.5 w-3.5" aria-hidden="true" />
                    </div>
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
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {canPreview ? (
                      <Button asChild variant="ghost" size="sm">
                        <a
                          href={downloadUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          data-testid="document-attachment-preview-link"
                          aria-label={t("attachments.previewFile", {
                            fileName: attachment.fileName,
                          })}
                          title={t("attachments.previewFile", {
                            fileName: attachment.fileName,
                          })}
                        >
                          <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                          {t("attachments.preview")}
                        </a>
                      </Button>
                    ) : null}
                    <Button asChild variant="ghost" size="sm">
                      <a
                        href={downloadUrl}
                        download={attachment.fileName}
                        rel="noopener noreferrer"
                        data-testid="document-attachment-download-link"
                        aria-label={t("attachments.downloadFile", {
                          fileName: attachment.fileName,
                        })}
                        title={t("attachments.downloadFile", {
                          fileName: attachment.fileName,
                        })}
                      >
                        <Download className="h-3.5 w-3.5" aria-hidden="true" />
                        {t("attachments.download")}
                      </a>
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">
            {t("attachments.empty")}
          </p>
        )}
        {shouldCollapseAttachments ? (
          <div className="flex justify-center border-t border-border/60 pt-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-expanded={showAllAttachments}
              data-testid="document-attachments-toggle"
              onClick={() => setShowAllAttachments((current) => !current)}
            >
              {showAllAttachments
                ? t("attachments.collapse")
                : t("attachments.showAll", {
                    count: attachments.length,
                  })}
            </Button>
          </div>
        ) : null}
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
          <DialogDescription>
            {t("description", { title: documentTitle })}
          </DialogDescription>
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

function RequirementCancelDialog({
  isCancelling,
  isLoading,
  onConfirm,
  onOpenChange,
  onReasonChange,
  onReferenceModeChange,
  open,
  reason,
  referenceCount,
  referenceMode,
}: {
  isCancelling: boolean;
  isLoading: boolean;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
  onReasonChange: (reason: string) => void;
  onReferenceModeChange: (
    mode: "REJECT_IF_REFERENCED" | "UNLINK_REFERENCES",
  ) => void;
  open: boolean;
  reason: string;
  referenceCount: number | null;
  referenceMode: "REJECT_IF_REFERENCED" | "UNLINK_REFERENCES";
}) {
  const t = useTranslations("documents.cancelRequirementDialog");
  const hasReferences = (referenceCount ?? 0) > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="document-cancel-requirement-dialog">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>
            {hasReferences
              ? t("descriptionWithReferences", { count: referenceCount ?? 0 })
              : t("description")}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          {hasReferences ? (
            <label className="grid gap-1.5 text-sm">
              <span className="font-medium">{t("referenceModeLabel")}</span>
              <SelectMenu
                aria-label={t("referenceModeLabel")}
                value={referenceMode}
                onChange={(event) =>
                  onReferenceModeChange(
                    event.target.value as
                      | "REJECT_IF_REFERENCED"
                      | "UNLINK_REFERENCES",
                  )
                }
              >
                <option value="REJECT_IF_REFERENCED">
                  {t("referenceModeReject")}
                </option>
                <option value="UNLINK_REFERENCES">
                  {t("referenceModeUnlink")}
                </option>
              </SelectMenu>
            </label>
          ) : null}
          <label className="grid gap-1.5 text-sm">
            <span className="font-medium">{t("reasonLabel")}</span>
            <Textarea
              value={reason}
              onChange={(event) => onReasonChange(event.target.value)}
              placeholder={t("reasonPlaceholder")}
              rows={3}
            />
          </label>
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={isCancelling}
            onClick={() => onOpenChange(false)}
          >
            {t("cancel")}
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={isLoading || isCancelling}
            onClick={onConfirm}
            data-testid="document-cancel-requirement-confirm"
          >
            {isCancelling ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <FileX2 className="h-4 w-4" aria-hidden="true" />
            )}
            {t("confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DocumentMoveFolderDialog({
  baseRevision,
  currentFolderId,
  documentId,
  onMoved,
  onOpenChange,
  open,
  organizationId,
  spaceId,
}: {
  baseRevision: number;
  currentFolderId: string | null;
  documentId: string;
  onMoved: (document: DocumentDetail) => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  organizationId?: string;
  spaceId: string;
}) {
  const t = useTranslations("documents.moveDialog");
  const tRoot = useTranslations();
  const [folders, setFolders] = useState<DocumentFolder[]>([]);
  const [selectedFolderId, setSelectedFolderId] = useState(
    currentFolderId ?? "",
  );
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    let cancelled = false;
    setSelectedFolderId(currentFolderId ?? "");
    setIsLoading(true);
    setErrorKey(null);
    void listDocumentFolders({ organizationId, spaceId })
      .then((next) => {
        if (!cancelled) {
          setFolders(next);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setErrorKey(getApiErrorMessageKey(error));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [currentFolderId, open, organizationId, spaceId]);

  const flatFolders = useMemo(
    () => flattenDocumentFolders(normalizeDocumentFolderTree(folders)),
    [folders],
  );

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setIsSaving(true);
    setErrorKey(null);
    try {
      const next = await moveDocumentToFolder({
        baseRevision,
        documentId,
        folderId: selectedFolderId || null,
        organizationId,
        spaceId,
      });
      onMoved(next);
      onOpenChange(false);
    } catch (error) {
      setErrorKey(getApiErrorMessageKey(error));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="document-move-folder-dialog">
        <form className="grid gap-4" onSubmit={(event) => void submit(event)}>
          <DialogHeader>
            <DialogTitle>{t("title")}</DialogTitle>
            <DialogDescription>{t("description")}</DialogDescription>
          </DialogHeader>

          <label className="grid gap-1.5 text-sm">
            <span className="font-medium">{t("folderLabel")}</span>
            <SelectMenu
              value={selectedFolderId}
              disabled={isLoading}
              onChange={(event) => setSelectedFolderId(event.target.value)}
              data-testid="document-move-folder-select"
            >
              <option value="">{t("unfiled")}</option>
              {flatFolders.map(({ depth, folder }) => (
                <option key={folder.id} value={folder.id}>
                  {`${"\u00A0\u00A0".repeat(depth)}${folder.name}`}
                </option>
              ))}
            </SelectMenu>
          </label>

          {isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              {t("loading")}
            </div>
          ) : null}

          {errorKey ? (
            <p className="text-sm text-destructive" role="alert">
              {tRoot(errorKey)}
            </p>
          ) : null}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={isSaving}
              onClick={() => onOpenChange(false)}
            >
              {t("cancel")}
            </Button>
            <Button type="submit" disabled={isSaving || isLoading}>
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

function DocumentTocRail({ headings }: { headings: MarkdownHeading[] }) {
  const t = useTranslations("documents");

  return (
    <aside className="hidden min-w-0 lg:sticky lg:top-16 lg:block lg:max-h-[calc(100vh-5rem)] lg:overflow-y-auto">
      <div className="px-1" data-testid="document-toc-rail">
        <RailSection
          icon={<FileText className="h-3.5 w-3.5" />}
          title={t("rail.toc")}
        >
          {headings.length > 0 ? (
            <nav aria-label={t("rail.toc")} className="grid gap-px">
              {headings.map((heading) => (
                <a
                  key={heading.id}
                  className={cn(
                    "truncate rounded px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    heading.level === 2 && "pl-4",
                    heading.level >= 3 && "pl-6",
                  )}
                  href={`#${heading.id}`}
                >
                  {heading.text}
                </a>
              ))}
            </nav>
          ) : (
            <p className="px-2 text-xs text-muted-foreground">
              {t("rail.noToc")}
            </p>
          )}
        </RailSection>
      </div>
    </aside>
  );
}

function DocumentContextRail({
  document,
  locale,
}: {
  document: DocumentDetail;
  locale: string;
}) {
  const t = useTranslations("documents");
  const tTimelineEvent = useTranslations("common.timeline.event");
  const commentTotal = document.commentTotal ?? document.comments?.length ?? 0;
  const attachmentTotal =
    document.attachmentTotal ?? document.attachments?.length ?? 0;
  const timelineItems = document.timeline ?? [];

  return (
    <aside className="min-w-0 lg:col-span-2 xl:col-span-1 xl:sticky xl:top-16 xl:max-h-[calc(100vh-5rem)] xl:overflow-y-auto">
      <div className="grid gap-5 px-1" data-testid="document-context-rail">
        <RailSection
          icon={<Link2 className="h-3.5 w-3.5" />}
          title={t("rail.resources")}
          hint={<OpenInNewTabHint label={t("rail.openInNewTabHint")} />}
        >
          <DocumentLinksSummary links={document.links ?? []} />
        </RailSection>
        <RailSection
          icon={<FileText className="h-3.5 w-3.5" />}
          title={t("references.documentTitle")}
          hint={<OpenInNewTabHint label={t("rail.openInNewTabHint")} />}
        >
          <ReferencingDocumentsSection
            compact
            hideHeader
            organizationId={document.organizationId}
            spaceId={document.spaceId}
            targetDocumentId={document.id}
            title={t("references.documentTitle")}
          />
        </RailSection>
        <RailSection
          icon={<Tags className="h-3.5 w-3.5" />}
          title={t("rail.tags")}
        >
          <TagBadgeList
            tags={document.tags ?? []}
            emptyLabel={t("rail.noTags")}
          />
        </RailSection>
        <RailSection
          icon={<MessageSquare className="h-3.5 w-3.5" />}
          title={t("rail.comments")}
        >
          <RailJumpLink
            count={commentTotal}
            emptyLabel={t("rail.noComments")}
            href="#document-comments"
            label={t("rail.viewAll", {
              count: commentTotal,
            })}
          />
        </RailSection>
        <RailSection
          icon={<Paperclip className="h-3.5 w-3.5" />}
          title={t("rail.attachments")}
        >
          <RailJumpLink
            count={attachmentTotal}
            emptyLabel={t("rail.noAttachments")}
            href="#document-attachments"
            label={t("rail.viewAll", {
              count: attachmentTotal,
            })}
          />
        </RailSection>
        <RailSection
          icon={<Clock3 className="h-3.5 w-3.5" />}
          title={t("rail.timeline")}
        >
          <div className="grid gap-1.5">
            {timelineItems.slice(0, 3).map((event) => (
              <div key={event.id} className="text-xs">
                <div className="flex min-w-0 items-baseline gap-1.5 text-foreground">
                  {event.actorName ? (
                    <span className="truncate font-medium">
                      {event.actorName}
                    </span>
                  ) : null}
                  <span className="truncate text-muted-foreground">
                    {tTimelineEvent(event.eventType)}
                  </span>
                </div>
                <div className="text-muted-foreground/80">
                  {formatDocumentRelativeTimestamp(event.createdAt, locale)}
                </div>
              </div>
            ))}
            {(document.timelineTotal ?? timelineItems.length) === 0 ? (
              <p className="text-xs text-muted-foreground">
                {t("rail.noTimeline")}
              </p>
            ) : null}
          </div>
        </RailSection>
        <dl className="grid gap-2.5 rounded-lg bg-muted/40 px-3 py-3 text-[11px] text-muted-foreground">
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
              <dt className="font-medium text-foreground">
                {t("rail.source")}
              </dt>
              <dd>{t(getDocumentSourceKey(document.sourceType))}</dd>
            </div>
            <div>
              <dt className="font-medium text-foreground">
                {t("rail.revision")}
              </dt>
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
  hint,
  icon,
  title,
}: {
  children: ReactNode;
  hint?: ReactNode;
  icon: ReactNode;
  title: string;
}) {
  return (
    <section className="grid gap-2">
      <h2 className="flex items-center gap-1.5 px-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/80">
        {icon}
        {title}
        {hint}
      </h2>
      {children}
    </section>
  );
}

function OpenInNewTabHint({ label }: { label: string }) {
  return (
    <Tip content={label} side="top">
      <span className="ml-auto inline-flex cursor-help text-muted-foreground/70 transition-colors hover:text-foreground">
        <Info className="h-3 w-3" aria-hidden="true" />
        <span className="sr-only">{label}</span>
      </span>
    </Tip>
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
  focusedAttachmentId?: string;
  focusedCommentId?: string;
  organizationId?: string;
  spaceId?: string;
}): Promise<DocumentDetail> {
  const document = await getDocument(input);
  const [comments, attachments, timeline] = await Promise.allSettled([
    listComments({
      organizationId: document.organizationId,
      page: 1,
      pageSize: input.focusedCommentId ? 200 : 20,
      spaceId: document.spaceId,
      targetId: document.id,
      targetType: "DOCUMENT",
    }),
    listAttachments({
      organizationId: document.organizationId,
      page: 1,
      pageSize: DOCUMENT_ATTACHMENT_LIST_PAGE_SIZE,
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
    attachmentTotal:
      attachments.status === "fulfilled"
        ? attachments.value.total
        : document.attachmentTotal,
    comments:
      comments.status === "fulfilled"
        ? comments.value.items.map(toDocumentCommentSummary)
        : document.comments,
    commentTotal:
      comments.status === "fulfilled"
        ? comments.value.total
        : document.commentTotal,
    timeline:
      timeline.status === "fulfilled"
        ? timeline.value.items.map(toDocumentTimelineSummary)
        : document.timeline,
    timelineTotal:
      timeline.status === "fulfilled"
        ? timeline.value.total
        : document.timelineTotal,
  };
}

function toDocumentAttachmentSummary(attachment: Attachment) {
  return {
    fileName: attachment.fileName,
    id: attachment.id,
    size: attachment.size,
  };
}

function canPreviewDocumentAttachment(attachment: { fileName: string }) {
  return !/\.(?:doc|docx)$/iu.test(attachment.fileName.trim());
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
    eventType: event.eventType,
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
  const targets: Array<{
    targetId: string;
    targetType: DocumentLinkWriteTargetType;
  }> = [];
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
  targets: Array<{
    targetId: string;
    targetType: DocumentLinkWriteTargetType;
  }>,
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
