"use client";

import type {
  AttachmentRef,
  Priority,
  Requirement,
  RequirementRelatedWorkItemSummary,
  RequirementStatus,
  SpaceMemberWithUser,
  UpdateRequirementRequest,
  Version,
} from "@project-delivery/shared";
import {
  Archive,
  Bug,
  Check,
  ChevronDown,
  CircleAlert,
  Clock,
  FileText,
  Loader2,
  Paperclip,
  PenLine,
  Save,
  Split,
  Trash2,
  User2,
  Flag,
  GitBranch as GitBranchIcon,
  Hash,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import {
  useEffect,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";

import { getApiErrorMessageKey } from "../../lib/api-error-messages";
import { formatDisplayCode } from "../../lib/display-code";
import {
  LOCAL_DRAFT_CACHE_WRITE_DELAY_MS,
  clearRequirementDraftLocalCache,
  createEmptyRequirementDraftCacheForm,
  createRequirementDraftCacheForm,
  createRequirementDraftLocalCacheKey,
  persistRequirementDraftLocalCacheSnapshot,
  resolveRequirementDraftCacheForm,
  type RequirementDraftCacheFormState,
  type RequirementDraftLocalCacheSnapshot,
} from "../../lib/requirement-draft-local-cache";
import {
  archiveRequirement,
  deleteRequirementDraft,
  getRequirement,
  listRequirementAssignableMembers,
  listRequirementVersions,
  updateRequirement,
} from "../../lib/requirement-service";
import { cn } from "../../lib/utils";
import {
  isTraceVersionCascadeRequiredError,
  traceVersionCascadeConfirmMessage,
} from "../../lib/versioned-trace-linking";
import { useRouter } from "../../i18n/routing";
import { useSession } from "../providers/session-provider";
import { TraceVersionCascadeConfirmDialog } from "../trace-version-cascade-confirm-dialog";
import { Badge, type BadgeProps } from "../ui/badge";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { RequirementContentEditorSlot } from "./requirement-content-editor-slot";

const PRIORITIES: Priority[] = ["LOW", "MEDIUM", "HIGH", "URGENT"];
const STATUS_VARIANT: Record<RequirementStatus, BadgeProps["variant"]> = {
  DRAFT: "outline",
  CONFIRMED: "primary",
  ARCHIVED: "default",
};

const STATUS_DOT: Record<RequirementStatus, string> = {
  DRAFT: "bg-muted-foreground/50",
  CONFIRMED: "bg-primary",
  ARCHIVED: "bg-muted-foreground/30",
};

const PRIORITY_VARIANT: Record<Priority, BadgeProps["variant"]> = {
  LOW: "outline",
  MEDIUM: "info",
  HIGH: "warning",
  URGENT: "destructive",
};

type RequirementDetailWorkspaceProps = {
  requirementId: string;
};

type RequirementFormState = RequirementDraftCacheFormState;

export function RequirementDetailWorkspace({
  requirementId,
}: RequirementDetailWorkspaceProps) {
  const t = useTranslations("requirements");
  const tRoot = useTranslations();
  const locale = useLocale();
  const router = useRouter();
  const { session, status } = useSession();
  const [requirement, setRequirement] = useState<Requirement | null>(null);
  const [versions, setVersions] = useState<Version[]>([]);
  const [members, setMembers] = useState<SpaceMemberWithUser[]>([]);
  const [form, setForm] = useState<RequirementFormState>(
    createEmptyRequirementForm(),
  );
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isArchiving, setIsArchiving] = useState(false);
  const [isDiscardingDraft, setIsDiscardingDraft] = useState(false);
  const [isDeletingDraftOnLeave, setIsDeletingDraftOnLeave] = useState(false);
  const [draftLeavePromptOpen, setDraftLeavePromptOpen] = useState(false);
  const [discardDraftConfirmOpen, setDiscardDraftConfirmOpen] = useState(false);
  const [pendingNavigationHref, setPendingNavigationHref] = useState<
    string | null
  >(null);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [pendingCascadeConfirm, setPendingCascadeConfirm] = useState<{
    request: UpdateRequirementRequest;
    message: string;
  } | null>(null);
  const [didRestoreLocalDraftCache, setDidRestoreLocalDraftCache] =
    useState(false);
  const titleInputRef = useRef<HTMLTextAreaElement>(null);
  const localDraftCacheSnapshotRef = useRef<RequirementDraftLocalCacheSnapshot>(
    {
      canEdit: false,
      form: createEmptyRequirementForm(),
      key: null,
      requirement: null,
    },
  );

  const currentSpace = useMemo(
    () =>
      requirement
        ? session?.spaces.find((space) => space.id === requirement.spaceId)
        : session?.spaces.find((space) => space.id === session.defaultSpaceId),
    [requirement, session],
  );
  const organizationId =
    requirement?.organizationId ??
    currentSpace?.organizationId ??
    session?.defaultOrganizationId;
  const spaceId = requirement?.spaceId ?? currentSpace?.id;
  const canUploadRequirementImages =
    requirement?.permissions?.canUploadAttachment === true;
  const canEditRequirement = requirement?.permissions?.canEdit === true;
  const localDraftCacheKey = useMemo(
    () =>
      requirement && session
        ? createRequirementDraftLocalCacheKey({
            organizationId: requirement.organizationId,
            requirementId: requirement.id,
            spaceId: requirement.spaceId,
            userId: session.user.id,
          })
        : null,
    [requirement, session],
  );
  const shouldPromptBeforeLeavingEmptyDraft = Boolean(
    requirement &&
    session &&
    canEditRequirement &&
    requirement.authorId === session.user.id &&
    isEmptyDraftRequirement(requirement, form) &&
    !isSaving &&
    !isDiscardingDraft &&
    !isDeletingDraftOnLeave,
  );
  const requestKey = useMemo(
    () =>
      [
        organizationId ?? "no-organization",
        spaceId ?? "no-space",
        requirementId,
      ].join(":"),
    [organizationId, requirementId, spaceId],
  );

  useEffect(() => {
    if (status !== "authenticated") {
      return;
    }

    let isActive = true;

    async function load() {
      setIsLoading(true);
      setErrorKey(null);

      try {
        const nextRequirement = await getRequirement({
          organizationId,
          requirementId,
          spaceId,
        });
        const [versionPage, memberPage] = await Promise.all([
          listRequirementVersions({
            organizationId: nextRequirement.organizationId,
            spaceId: nextRequirement.spaceId,
          }),
          listRequirementAssignableMembers({
            organizationId: nextRequirement.organizationId,
            spaceId: nextRequirement.spaceId,
          }),
        ]);

        if (!isActive) {
          return;
        }

        setRequirement(nextRequirement);
        setVersions(versionPage.items);
        setMembers(memberPage.items);
        const nextForm = requirementToFormState(nextRequirement);
        const cachedForm = resolveRequirementDraftCacheForm(
          nextRequirement,
          nextForm,
          session?.user.id,
        );
        setForm(cachedForm.form);
        setDidRestoreLocalDraftCache(cachedForm.restored);
      } catch (error) {
        if (isActive) {
          setErrorKey(getApiErrorMessageKey(error));
        }
      } finally {
        if (isActive) {
          setIsLoading(false);
        }
      }
    }

    void load();

    return () => {
      isActive = false;
    };
  }, [
    organizationId,
    requestKey,
    requirementId,
    session?.user.id,
    spaceId,
    status,
  ]);

  useEffect(() => {
    resizeTitleInput(titleInputRef.current);
  }, [form.title]);

  useLayoutEffect(() => {
    localDraftCacheSnapshotRef.current = {
      canEdit: canEditRequirement,
      form,
      key: localDraftCacheKey,
      requirement,
    };
  }, [canEditRequirement, form, localDraftCacheKey, requirement]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      persistRequirementDraftLocalCacheSnapshot(
        localDraftCacheSnapshotRef.current,
      );
    }, LOCAL_DRAFT_CACHE_WRITE_DELAY_MS);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [canEditRequirement, form, localDraftCacheKey, requirement]);

  useEffect(() => {
    function flushLocalDraftCache() {
      persistRequirementDraftLocalCacheSnapshot(
        localDraftCacheSnapshotRef.current,
      );
    }

    function flushLocalDraftCacheWhenHidden() {
      if (document.visibilityState === "hidden") {
        flushLocalDraftCache();
      }
    }

    window.addEventListener("beforeunload", flushLocalDraftCache);
    window.addEventListener("pagehide", flushLocalDraftCache);
    document.addEventListener(
      "visibilitychange",
      flushLocalDraftCacheWhenHidden,
    );

    return () => {
      window.removeEventListener("beforeunload", flushLocalDraftCache);
      window.removeEventListener("pagehide", flushLocalDraftCache);
      document.removeEventListener(
        "visibilitychange",
        flushLocalDraftCacheWhenHidden,
      );
    };
  }, []);

  useEffect(
    () => () => {
      persistRequirementDraftLocalCacheSnapshot(
        localDraftCacheSnapshotRef.current,
      );
    },
    [],
  );

  function clearLocalDraftCacheForCurrentRequirement() {
    clearRequirementDraftLocalCache(localDraftCacheKey);
    localDraftCacheSnapshotRef.current = {
      canEdit: false,
      form,
      key: null,
      requirement: null,
    };
    setDidRestoreLocalDraftCache(false);
  }

  const requestEmptyDraftLeaveDecision = useCallback((href: string) => {
    setPendingNavigationHref(href);
    setDraftLeavePromptOpen(true);
  }, []);

  useEffect(() => {
    if (!shouldPromptBeforeLeavingEmptyDraft) {
      return;
    }

    function onDocumentClick(event: MouseEvent) {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }

      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }

      const anchor = target.closest("a[href]");
      if (!(anchor instanceof HTMLAnchorElement)) {
        return;
      }

      if (anchor.target && anchor.target !== "_self") {
        return;
      }

      const href = anchor.getAttribute("href");
      if (
        !href ||
        href.startsWith("#") ||
        href.startsWith("mailto:") ||
        href.startsWith("tel:")
      ) {
        return;
      }

      const currentUrl = new URL(window.location.href);
      const nextUrl = new URL(href, currentUrl.href);
      if (nextUrl.href === currentUrl.href) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      requestEmptyDraftLeaveDecision(
        nextUrl.origin === currentUrl.origin
          ? `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`
          : nextUrl.href,
      );
    }

    document.addEventListener("click", onDocumentClick, true);

    return () => {
      document.removeEventListener("click", onDocumentClick, true);
    };
  }, [requestEmptyDraftLeaveDecision, shouldPromptBeforeLeavingEmptyDraft]);

  useEffect(() => {
    if (!shouldPromptBeforeLeavingEmptyDraft) {
      return;
    }

    function onBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = t("detail.emptyDraftLeave.browserWarning");
    }

    window.addEventListener("beforeunload", onBeforeUnload);

    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [shouldPromptBeforeLeavingEmptyDraft, t]);

  async function onSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!requirement || !canEditRequirement) {
      return;
    }

    setIsSaving(true);
    setErrorKey(null);

    const context = {
      organizationId: requirement.organizationId,
      requirementId: requirement.id,
      spaceId: requirement.spaceId,
    };
    const request = formStateToSaveRequest(form);

    try {
      const nextRequirement = await updateRequirement(context, request);
      clearLocalDraftCacheForCurrentRequirement();
      setRequirement(nextRequirement);
      setForm(requirementToFormState(nextRequirement));
    } catch (error) {
      if (isTraceVersionCascadeRequiredError(error)) {
        setPendingCascadeConfirm({
          request,
          message: traceVersionCascadeConfirmMessage({
            body: tRoot("errors.api.TRACE_VERSION_CHANGE_REQUIRES_CASCADE"),
            suffix: tRoot(
              "errors.api.TRACE_VERSION_CHANGE_REQUIRES_CASCADE_CONFIRM_SUFFIX",
            ),
          }),
        });
        return;
      }
      setErrorKey(getApiErrorMessageKey(error));
    } finally {
      setIsSaving(false);
    }
  }

  async function handleConfirmCascadeVersionChange() {
    if (!requirement || !canEditRequirement || !pendingCascadeConfirm) {
      return;
    }

    setIsSaving(true);
    setErrorKey(null);

    try {
      const nextRequirement = await updateRequirement(
        {
          organizationId: requirement.organizationId,
          requirementId: requirement.id,
          spaceId: requirement.spaceId,
        },
        {
          ...pendingCascadeConfirm.request,
          cascadeVersionChange: true,
        },
      );
      setPendingCascadeConfirm(null);
      clearLocalDraftCacheForCurrentRequirement();
      setRequirement(nextRequirement);
      setForm(requirementToFormState(nextRequirement));
    } catch (error) {
      setPendingCascadeConfirm(null);
      setErrorKey(getApiErrorMessageKey(error));
    } finally {
      setIsSaving(false);
    }
  }

  async function onArchive() {
    if (!requirement || !canEditRequirement) {
      return;
    }

    setIsArchiving(true);
    setErrorKey(null);

    try {
      const nextRequirement = await archiveRequirement({
        organizationId: requirement.organizationId,
        requirementId: requirement.id,
        spaceId: requirement.spaceId,
      });
      clearLocalDraftCacheForCurrentRequirement();
      setRequirement(nextRequirement);
      setForm(requirementToFormState(nextRequirement));
    } catch (error) {
      setErrorKey(getApiErrorMessageKey(error));
    } finally {
      setIsArchiving(false);
    }
  }

  async function onDiscardDraft() {
    if (
      !requirement ||
      !canEditRequirement ||
      !isEmptyDraftRequirement(requirement, form)
    ) {
      return;
    }

    setIsDiscardingDraft(true);
    setErrorKey(null);

    try {
      await deleteRequirementDraft({
        organizationId: requirement.organizationId,
        requirementId: requirement.id,
        spaceId: requirement.spaceId,
      });
      clearLocalDraftCacheForCurrentRequirement();
      setDiscardDraftConfirmOpen(false);
      router.push("/requirements");
    } catch (error) {
      setErrorKey(getApiErrorMessageKey(error));
    } finally {
      setIsDiscardingDraft(false);
    }
  }

  function onKeepEmptyDraftAndLeave() {
    const target = pendingNavigationHref;
    setDraftLeavePromptOpen(false);
    setPendingNavigationHref(null);

    if (target) {
      router.push(target);
    }
  }

  async function onDeleteEmptyDraftAndLeave() {
    if (!requirement || !canEditRequirement) {
      return;
    }

    const target = pendingNavigationHref ?? "/requirements";
    setIsDeletingDraftOnLeave(true);
    setErrorKey(null);

    try {
      await deleteRequirementDraft({
        organizationId: requirement.organizationId,
        requirementId: requirement.id,
        spaceId: requirement.spaceId,
      });
      clearLocalDraftCacheForCurrentRequirement();
      setDraftLeavePromptOpen(false);
      setPendingNavigationHref(null);
      router.push(target);
    } catch (error) {
      setErrorKey(getApiErrorMessageKey(error));
    } finally {
      setIsDeletingDraftOnLeave(false);
    }
  }

  if (status === "loading" || isLoading) {
    return (
      <StatePanel
        icon="loading"
        title={t("states.loading.title")}
        description={t("states.loading.description")}
      />
    );
  }

  if (status === "unauthenticated" || !session) {
    return (
      <StatePanel
        icon="warning"
        title={t("states.unauthenticated.title")}
        description={t("states.unauthenticated.description")}
      />
    );
  }

  if (!requirement && errorKey) {
    return (
      <StatePanel
        icon="warning"
        title={t("states.loadFailed.title")}
        description={tRoot(errorKey)}
      />
    );
  }

  if (!requirement) {
    return (
      <StatePanel
        icon="warning"
        title={t("states.loadFailed.title")}
        description={t("states.loadFailed.description")}
      />
    );
  }

  const titleValue = form.title;
  const titlePlaceholder = t("detail.untitledDraft");
  const ownerLabel = formatOwnerName(form.ownerId, members);
  const authorLabel = formatOwnerName(requirement.authorId, members);
  const versionLabel = formatVersionName(form.versionId, versions);
  const shortId = formatDisplayCode("REQ", requirement.id);
  const lastModifiedLabel = formatTimestamp(requirement.updatedAt, locale);
  const canDiscardDraft =
    canEditRequirement &&
    requirement.authorId === session.user.id &&
    isEmptyDraftRequirement(requirement, form);

  return (
    <>
      <form className="flex flex-col gap-6" onSubmit={onSave}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <FileText className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{t("detail.eyebrow")}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:justify-end">
            {!canEditRequirement ? (
              <span className="text-[11px] text-muted-foreground">
                {t("form.readonly")}
              </span>
            ) : null}
            {canDiscardDraft ? (
              <Button
                disabled={isDiscardingDraft}
                data-testid="requirement-discard-draft-button"
                onClick={() => setDiscardDraftConfirmOpen(true)}
                size="sm"
                type="button"
                variant="destructive"
              >
                <Trash2 aria-hidden="true" />
                {isDiscardingDraft
                  ? t("detail.discardingDraft")
                  : t("detail.discardDraft")}
              </Button>
            ) : null}
            <Button
              disabled={!canEditRequirement || isArchiving || isDiscardingDraft}
              onClick={() => void onArchive()}
              size="sm"
              type="button"
              variant="ghost"
            >
              <Archive aria-hidden="true" />
              {isArchiving ? t("detail.archiving") : t("detail.archive")}
            </Button>
            <Button
              disabled={!canEditRequirement || isSaving || isDiscardingDraft}
              size="sm"
              type="submit"
            >
              <Save aria-hidden="true" />
              {isSaving ? t("detail.saving") : t("detail.save")}
            </Button>
          </div>
        </div>

        {errorKey ? (
          <div
            className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            role="alert"
          >
            {tRoot(errorKey)}
          </div>
        ) : null}

        {didRestoreLocalDraftCache ? (
          <div
            className="rounded-md border border-info/30 bg-info/10 px-3 py-2 text-sm text-info"
            data-testid="requirement-local-draft-cache-restored"
            role="status"
          >
            {t("detail.localDraftCache.restored")}
          </div>
        ) : null}

        {/* Big Notion-style title */}
        <div className="flex flex-col gap-2 pt-2">
          <textarea
            aria-label={t("form.title")}
            className={cn(
              "w-full resize-none overflow-hidden border-0 bg-transparent p-0 text-4xl font-bold tracking-tight text-foreground outline-none",
              "placeholder:text-muted-foreground/40",
              "focus-visible:outline-none focus-visible:ring-0",
              "disabled:cursor-not-allowed disabled:opacity-70",
              "md:text-[2.5rem] md:leading-[1.15]",
            )}
            disabled={!canEditRequirement}
            maxLength={200}
            onChange={(event) => {
              resizeTitleInput(event.currentTarget);
              setForm((current) => ({
                ...current,
                title: event.target.value,
              }));
            }}
            placeholder={titlePlaceholder}
            ref={titleInputRef}
            required
            rows={1}
            value={titleValue}
          />

          {/* Notion-style property strip */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pt-1 text-xs">
            <PropertyItem
              icon={<StatusDot status={requirement.status} />}
              label={t("detail.fields.status")}
            >
              <Badge variant={STATUS_VARIANT[requirement.status]}>
                {t(`status.${requirement.status}`)}
              </Badge>
            </PropertyItem>

            <PropertyItem
              icon={<Hash className="h-3.5 w-3.5" />}
              label={t("detail.fields.id")}
            >
              <span className="font-mono text-[11px] text-foreground/80">
                {shortId}
              </span>
            </PropertyItem>

            <PropertyItem
              icon={<GitBranchIcon className="h-3.5 w-3.5" />}
              label={t("form.version")}
            >
              <PropertySelect
                ariaLabel={t("form.version")}
                disabled={!canEditRequirement}
                onChange={(value) =>
                  setForm((current) => ({ ...current, versionId: value }))
                }
                placeholder={t("form.noVersion")}
                value={form.versionId}
                displayValue={versionLabel ?? null}
                options={[
                  { label: t("form.noVersion"), value: "" },
                  ...versions.map((version) => ({
                    label: version.name,
                    value: version.id,
                  })),
                ]}
              />
            </PropertyItem>

            <PropertyItem
              icon={<User2 className="h-3.5 w-3.5" />}
              label={t("form.owner")}
            >
              <PropertySelect
                ariaLabel={t("form.owner")}
                disabled={!canEditRequirement}
                onChange={(value) =>
                  setForm((current) => ({ ...current, ownerId: value }))
                }
                placeholder={t("form.noOwner")}
                value={form.ownerId}
                displayValue={ownerLabel ?? null}
                options={[
                  { label: t("form.noOwner"), value: "" },
                  ...members.map((member) => ({
                    label: formatMember(member),
                    value: member.userId,
                  })),
                ]}
              />
            </PropertyItem>

            <PropertyItem
              icon={<Flag className="h-3.5 w-3.5" />}
              label={t("form.priority")}
            >
              <PropertySelect
                ariaLabel={t("form.priority")}
                disabled={!canEditRequirement}
                onChange={(value) =>
                  setForm((current) => ({
                    ...current,
                    priority: value as Priority | "",
                  }))
                }
                placeholder={t("form.noPriority")}
                value={form.priority}
                displayValue={
                  form.priority ? (
                    <Badge variant={PRIORITY_VARIANT[form.priority]}>
                      {t(`priority.${form.priority}`)}
                    </Badge>
                  ) : null
                }
                options={[
                  { label: t("form.noPriority"), value: "" },
                  ...PRIORITIES.map((priority) => ({
                    label: t(`priority.${priority}`),
                    value: priority,
                  })),
                ]}
              />
            </PropertyItem>

            <PropertyItem
              icon={<PenLine className="h-3.5 w-3.5" />}
              label={t("detail.fields.author")}
            >
              <span className="text-foreground/80">
                {authorLabel ?? t("detail.fields.unknownAuthor")}
              </span>
            </PropertyItem>

            <PropertyItem
              icon={<Clock className="h-3.5 w-3.5" />}
              label={t("detail.fields.lastModified")}
            >
              <span className="text-foreground/80">{lastModifiedLabel}</span>
            </PropertyItem>

            <PropertyItem
              icon={<Paperclip className="h-3.5 w-3.5" />}
              label={t("detail.attachments")}
            >
              <span className="text-foreground/80">
                {requirement.attachments?.length ?? 0}
              </span>
            </PropertyItem>
          </div>
        </div>

        {/* Summary as an inline textarea — soft hairline, no panel */}
        <div className="border-t border-border/60 pt-4">
          <label className="block">
            <span className="sr-only">{t("form.summary")}</span>
            <textarea
              className={cn(
                "w-full resize-y border-0 bg-transparent p-0 text-base leading-relaxed text-foreground/90 outline-none",
                "placeholder:text-muted-foreground/50",
                "focus-visible:outline-none focus-visible:ring-0",
                "disabled:cursor-not-allowed disabled:opacity-70",
              )}
              disabled={!canEditRequirement}
              maxLength={2000}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  summary: event.target.value,
                }))
              }
              placeholder={t("detail.summaryPlaceholder")}
              rows={2}
              value={form.summary}
            />
          </label>
        </div>

        {/* Block-level editor — no card, no border around it */}
        <div className="pt-1">
          <RequirementContentEditorSlot
            attachmentCount={requirement.attachments?.length ?? 0}
            canUploadImages={canEditRequirement && canUploadRequirementImages}
            disabled={!canEditRequirement}
            onAttachmentUploaded={(attachment) =>
              setRequirement((current) =>
                current
                  ? {
                      ...current,
                      attachments: appendAttachmentRef(
                        current.attachments,
                        attachment,
                      ),
                    }
                  : current,
              )
            }
            onChange={(content) =>
              setForm((current) => ({
                ...current,
                content,
              }))
            }
            requirementId={requirement.id}
            value={form.content}
          />
        </div>

        {/* Related work items — minimal, flat section */}
        <RelatedWorkItemsSection requirement={requirement} t={t} />
      </form>

      <TraceVersionCascadeConfirmDialog
        message={pendingCascadeConfirm?.message ?? ""}
        onCancel={() => setPendingCascadeConfirm(null)}
        onConfirm={() => void handleConfirmCascadeVersionChange()}
        open={pendingCascadeConfirm !== null}
        submitting={isSaving}
      />

      <Dialog
        open={discardDraftConfirmOpen}
        onOpenChange={(open) => {
          if (!isDiscardingDraft) {
            setDiscardDraftConfirmOpen(open);
          }
        }}
      >
        <DialogContent data-testid="requirement-discard-draft-dialog">
          <DialogHeader>
            <DialogTitle>{t("detail.discardDraft")}</DialogTitle>
            <DialogDescription>
              {t("detail.discardDraftConfirm")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              data-testid="requirement-discard-draft-cancel"
              disabled={isDiscardingDraft}
              onClick={() => setDiscardDraftConfirmOpen(false)}
              size="sm"
              type="button"
              variant="outline"
            >
              {tRoot("common.actions.close")}
            </Button>
            <Button
              data-testid="requirement-discard-draft-confirm"
              disabled={isDiscardingDraft}
              onClick={() => void onDiscardDraft()}
              size="sm"
              type="button"
              variant="destructive"
            >
              {isDiscardingDraft
                ? t("detail.discardingDraft")
                : t("detail.discardDraft")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={draftLeavePromptOpen}
        onOpenChange={(open) => {
          if (!open && !isDeletingDraftOnLeave) {
            setDraftLeavePromptOpen(false);
            setPendingNavigationHref(null);
          }
        }}
      >
        <DialogContent data-testid="requirement-empty-draft-leave-dialog">
          <DialogHeader>
            <DialogTitle>{t("detail.emptyDraftLeave.title")}</DialogTitle>
            <DialogDescription>
              {t("detail.emptyDraftLeave.description")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              data-testid="requirement-empty-draft-keep"
              disabled={isDeletingDraftOnLeave}
              onClick={onKeepEmptyDraftAndLeave}
              size="sm"
              type="button"
              variant="outline"
            >
              {t("detail.emptyDraftLeave.keep")}
            </Button>
            <Button
              data-testid="requirement-empty-draft-delete"
              disabled={isDeletingDraftOnLeave}
              onClick={() => void onDeleteEmptyDraftAndLeave()}
              size="sm"
              type="button"
              variant="destructive"
            >
              {isDeletingDraftOnLeave
                ? t("detail.emptyDraftLeave.deleting")
                : t("detail.emptyDraftLeave.delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

type PropertyItemProps = {
  icon: ReactNode;
  label: string;
  children: ReactNode;
};

function PropertyItem({ icon, label, children }: PropertyItemProps) {
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <span className="flex shrink-0 items-center gap-1 text-muted-foreground">
        {icon}
        <span>{label}</span>
      </span>
      <span className="flex min-w-0 items-center text-foreground/90">
        {children}
      </span>
    </div>
  );
}

type PropertySelectOption = {
  label: ReactNode;
  value: string;
};

type PropertySelectProps = {
  ariaLabel: string;
  disabled?: boolean;
  onChange: (value: string) => void;
  placeholder: string;
  value: string;
  displayValue: ReactNode;
  options: PropertySelectOption[];
};

/**
 * Notion-style inline selector backed by Radix DropdownMenu. Native select
 * popups are not themeable enough across browsers, especially in dark mode.
 */
function PropertySelect({
  ariaLabel,
  disabled,
  onChange,
  placeholder,
  value,
  displayValue,
  options,
}: PropertySelectProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <button
          aria-label={ariaLabel}
          className={cn(
            "inline-flex max-w-[16rem] items-center gap-1 rounded-md px-1.5 py-0.5 text-left outline-none transition-colors",
            "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
            !disabled && "cursor-pointer hover:bg-muted",
            disabled && "cursor-not-allowed opacity-80",
          )}
          disabled={disabled}
          type="button"
        >
          <span className="min-w-0 truncate">
            {displayValue ?? (
              <span className="text-muted-foreground/80">{placeholder}</span>
            )}
          </span>
          {!disabled ? (
            <ChevronDown
              aria-hidden="true"
              className="h-3 w-3 shrink-0 text-muted-foreground"
            />
          ) : null}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="max-w-[min(20rem,calc(100vw-2rem))] min-w-[12rem]"
      >
        {options.map((option) => (
          <DropdownMenuItem
            key={option.value || "__empty"}
            onSelect={() => onChange(option.value)}
          >
            <Check
              aria-hidden="true"
              className={cn(
                "h-3.5 w-3.5 shrink-0",
                value === option.value ? "opacity-100" : "opacity-0",
              )}
            />
            <span className="min-w-0 truncate">{option.label}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function resizeTitleInput(element: HTMLTextAreaElement | null) {
  if (!element) {
    return;
  }

  element.style.height = "auto";
  element.style.height = `${Math.max(element.scrollHeight, 48)}px`;
}

function StatusDot({ status }: { status: RequirementStatus }) {
  return (
    <span
      aria-hidden="true"
      className={cn("h-2 w-2 shrink-0 rounded-full", STATUS_DOT[status])}
    />
  );
}

type RelatedWorkItemsSectionProps = {
  requirement: Requirement;
  t: ReturnType<typeof useTranslations>;
};

function RelatedWorkItemsSection({
  requirement,
  t,
}: RelatedWorkItemsSectionProps) {
  const related = requirement.relatedWorkItems;
  const isEmpty = related.tasks.length === 0 && related.bugs.length === 0;

  return (
    <section
      aria-labelledby="related-work-items-title"
      className="flex flex-col gap-3 border-t border-border/60 pt-6"
    >
      <header className="flex items-baseline justify-between gap-2">
        <h2
          className="text-sm font-semibold text-foreground"
          id="related-work-items-title"
        >
          {t("relatedWorkItems.title")}
        </h2>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span>
            {t("relatedWorkItems.tasks")}{" "}
            <strong className="text-foreground">{related.taskCount}</strong>
          </span>
          <span>
            {t("relatedWorkItems.bugs")}{" "}
            <strong className="text-foreground">{related.bugCount}</strong>
          </span>
        </div>
      </header>

      {isEmpty ? (
        <p className="text-xs text-muted-foreground">
          {t("relatedWorkItems.emptyDescription")}
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-border/50 rounded-md border border-border/50 bg-background">
          {related.tasks.map((item) => (
            <RelatedWorkItemRow icon="task" item={item} key={item.id} t={t} />
          ))}
          {related.bugs.map((item) => (
            <RelatedWorkItemRow icon="bug" item={item} key={item.id} t={t} />
          ))}
        </ul>
      )}
    </section>
  );
}

function RelatedWorkItemRow({
  icon,
  item,
  t,
}: {
  icon: "bug" | "task";
  item: RequirementRelatedWorkItemSummary;
  t: ReturnType<typeof useTranslations>;
}) {
  const Icon = icon === "bug" ? Bug : Split;

  return (
    <li className="flex items-center gap-2.5 px-3 py-2 text-sm">
      <Icon
        aria-hidden="true"
        className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
        strokeWidth={2}
      />
      <span className="flex-1 truncate text-foreground/90">{item.title}</span>
      <span className="shrink-0 text-xs text-muted-foreground">
        {item.statusCategory
          ? t(`statusCategory.${item.statusCategory}`)
          : t("relatedWorkItems.noStatus")}
      </span>
    </li>
  );
}

function StatePanel({
  description,
  icon,
  title,
}: {
  description: string;
  icon: "loading" | "warning";
  title: string;
}) {
  const Icon = icon === "loading" ? Loader2 : CircleAlert;

  return (
    <section
      aria-live="polite"
      className="flex flex-col items-center justify-center gap-3 rounded-lg border border-border/60 bg-background/40 px-6 py-12 text-center"
    >
      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Icon
          aria-hidden="true"
          className={cn("h-4 w-4", icon === "loading" && "animate-spin")}
          strokeWidth={2}
        />
      </div>
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      <p className="max-w-md text-xs text-muted-foreground">{description}</p>
    </section>
  );
}

function createEmptyRequirementForm(): RequirementFormState {
  return createEmptyRequirementDraftCacheForm();
}

function requirementToFormState(
  requirement: Requirement,
): RequirementFormState {
  return createRequirementDraftCacheForm(requirement);
}

function formStateToSaveRequest(
  form: RequirementFormState,
): UpdateRequirementRequest {
  return {
    contentJson: form.content.contentJson,
    contentMarkdownCache: optionalText(form.content.contentMarkdownCache ?? ""),
    contentText: optionalText(form.content.contentText),
    ownerId: optionalText(form.ownerId),
    priority: form.priority || undefined,
    summary: optionalText(form.summary),
    title: form.title.trim(),
    versionId: optionalText(form.versionId) ?? null,
  };
}

function isEmptyDraftRequirement(
  requirement: Requirement,
  form: RequirementFormState,
): boolean {
  return (
    requirement.status === "DRAFT" &&
    form.title.trim().length === 0 &&
    form.summary.trim().length === 0 &&
    form.content.contentText.trim().length === 0 &&
    !hasMeaningfulTiptapContent(form.content.contentJson) &&
    (requirement.attachments?.length ?? 0) === 0
  );
}

function hasMeaningfulTiptapContent(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some((item) => hasMeaningfulTiptapContent(item));
  }

  if (!isPlainRecord(value)) {
    return false;
  }

  if (typeof value.text === "string" && value.text.trim().length > 0) {
    return true;
  }

  if (
    typeof value.type === "string" &&
    !["doc", "paragraph", "text"].includes(value.type)
  ) {
    return true;
  }

  return hasMeaningfulTiptapContent(value.content);
}

function appendAttachmentRef(
  current: AttachmentRef[] | undefined,
  attachment: AttachmentRef,
): AttachmentRef[] {
  const attachments = current ?? [];

  if (attachments.some((item) => item.id === attachment.id)) {
    return attachments;
  }

  return [...attachments, attachment];
}

function optionalText(value: string): string | undefined {
  const trimmed = value.trim();

  return trimmed.length > 0 ? trimmed : undefined;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatMember(member: SpaceMemberWithUser) {
  return `${member.user.name} (${member.user.username})`;
}

function formatOwnerName(
  ownerId: string | undefined,
  members: SpaceMemberWithUser[],
) {
  if (!ownerId) {
    return undefined;
  }

  const member = members.find((item) => item.userId === ownerId);

  return member ? formatMember(member) : ownerId;
}

function formatVersionName(versionId: string | undefined, versions: Version[]) {
  if (!versionId) {
    return undefined;
  }

  return (
    versions.find((version) => version.id === versionId)?.name ?? versionId
  );
}

function formatTimestamp(value: string, locale: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  try {
    return new Intl.DateTimeFormat(locale, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(date);
  } catch {
    return date.toISOString();
  }
}
