"use client";

import type {
  Attachment,
  Comment,
  PermissionSnapshot,
  TimelineEvent,
  WorkItemDetail,
  WorkflowActionSummary,
} from "@project-delivery/shared";
import {
  AlertCircle,
  Bug,
  CheckCircle2,
  ChevronRight,
  Clock,
  GitBranch,
  Link2,
  Loader2,
  MessageSquare,
  Paperclip,
  Send,
  User2,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import type React from "react";

import { getApiErrorMessageKey } from "../../lib/api-error-messages";
import {
  AttachmentUploadError,
  listAttachments,
  uploadAttachment,
} from "../../lib/attachment-service";
import { executeAction } from "../../lib/action-service";
import { getBug } from "../../lib/bug-service";
import { createComment, listComments } from "../../lib/comment-service";
import { listTimeline } from "../../lib/timeline-service";
import { cn } from "../../lib/utils";
import { type WorkItemViewModel } from "../../lib/v2/work-item-view-model";
import { useSpaceMembers, useVersions } from "../../lib/v2/lookups";
import { getWorkItem } from "../../lib/work-item-service";

import { useSession } from "../providers/session-provider";
import { Avatar, AvatarFallback, AvatarImage } from "../ui/avatar";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Kbd } from "../ui/kbd";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "../ui/sheet";
import { StatusBadge } from "../ui/status-badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";
import { EmptyState, ErrorState, LoadingState } from "../v2/states";

const priorityColor: Record<WorkItemViewModel["priority"], string> = {
  LOW: "text-muted-foreground",
  MEDIUM: "text-info",
  HIGH: "text-warning",
  URGENT: "text-destructive",
};

type Props = {
  item: WorkItemViewModel | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Optional override; falls back to current session space. */
  spaceId?: string;
  /** Optional override; falls back to current session organization. */
  organizationId?: string;
  /** Optional override; falls back to current session user id. */
  currentUserId?: string;
};

/**
 * Display label for an actor identity.
 * Prefers the cached space-member display name; otherwise falls back to a
 * truncated id so that the UI never collapses on missing lookup data.
 */
function displayUser(
  userId: string | undefined,
  getMember: (id: string) => { user: { name: string } } | undefined,
): { name: string; initial: string } {
  if (!userId) {
    return { name: "—", initial: "?" };
  }

  const member = getMember(userId);
  const name = member?.user.name ?? truncateId(userId);
  const initial = name.trim().slice(0, 1).toUpperCase() || "?";
  return { name, initial };
}

function truncateId(id: string): string {
  if (id.length <= 8) return id;
  return `${id.slice(0, 4)}…${id.slice(-4)}`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDateTime(value: string, locale: string): string {
  try {
    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return value;
    }

    return new Intl.DateTimeFormat(locale, {
      dateStyle: "short",
      timeStyle: "short",
    }).format(date);
  } catch {
    return value;
  }
}

type SheetDetail = Pick<
  WorkItemDetail,
  "versionId" | "requirementId" | "intakeItemId" | "reporterId"
> & {
  permissions?: PermissionSnapshot;
};

async function loadSheetDetail({
  item,
  organizationId,
  spaceId,
}: {
  item: Pick<WorkItemViewModel, "id" | "type">;
  organizationId?: string;
  spaceId?: string;
}): Promise<SheetDetail> {
  if (item.type === "BUG") {
    const bug = await getBug({
      bugId: item.id,
      organizationId,
      spaceId: spaceId ?? "",
    });
    return bug;
  }

  return getWorkItem({
    organizationId,
    spaceId,
    workItemId: item.id,
  });
}

export function TaskDetailSheet({
  item,
  open,
  onOpenChange,
  spaceId: spaceIdProp,
  organizationId: organizationIdProp,
  currentUserId: currentUserIdProp,
}: Props) {
  const t = useTranslations("taskDetail");
  const tApiError = useTranslations();
  const { currentSpace, currentOrganization, session } = useSession();

  const spaceId = spaceIdProp ?? currentSpace?.id;
  const organizationId = organizationIdProp ?? currentOrganization?.id;
  const currentUserId = currentUserIdProp ?? session?.user.id;

  if (!item) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent data-testid="task-detail-sheet" data-state-empty="true">
          <SheetHeader className="sr-only">
            <SheetTitle>{t("emptyTitle")}</SheetTitle>
            <SheetDescription>{t("emptyDescription")}</SheetDescription>
          </SheetHeader>
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            {t("empty")}
          </div>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <TaskDetailSheetBody
        item={item}
        spaceId={spaceId}
        organizationId={organizationId}
        currentUserId={currentUserId}
        t={t}
        tApiError={tApiError}
      />
    </Sheet>
  );
}

type BodyProps = {
  item: WorkItemViewModel;
  spaceId?: string;
  organizationId?: string;
  currentUserId?: string;
  t: ReturnType<typeof useTranslations<"taskDetail">>;
  tApiError: ReturnType<typeof useTranslations>;
};

function TaskDetailSheetBody({
  item,
  spaceId,
  organizationId,
  currentUserId: _currentUserId,
  t,
  tApiError,
}: BodyProps) {
  const isBug = item.type === "BUG";
  const lookup = useSpaceMembers(spaceId, organizationId);
  const permissionState = useWorkItemPermissions({
    item,
    organizationId,
    spaceId,
    tApiError,
  });

  return (
    <SheetContent
      data-testid="task-detail-sheet"
      data-task-id={item.id}
      className="flex flex-col gap-0 p-0"
    >
      <SheetHeader className="px-5 py-4">
        <div className="flex items-center gap-2 text-[11px] font-mono text-muted-foreground">
          {isBug ? (
            <Bug className="h-3.5 w-3.5 text-destructive" />
          ) : (
            <CheckCircle2 className="h-3.5 w-3.5 text-primary" />
          )}
          <span>{item.code}</span>
          <ChevronRight className="h-3 w-3" />
          <span className="truncate">{item.versionName}</span>
        </div>
        <SheetTitle className="mt-1 text-base leading-snug">
          {item.title}
        </SheetTitle>
        <SheetDescription className="sr-only">
          {isBug ? t("sheetDescription.bug") : t("sheetDescription.task")}
        </SheetDescription>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <StatusBadge
            category={item.statusCategory}
            label={item.statusLabel}
          />
          <Badge
            variant="outline"
            className={cn("gap-1", priorityColor[item.priority])}
          >
            <span
              className={cn(
                "h-1.5 w-1.5 rounded-full",
                item.priority === "URGENT" && "bg-destructive",
                item.priority === "HIGH" && "bg-warning",
                item.priority === "MEDIUM" && "bg-info",
                item.priority === "LOW" && "bg-muted-foreground",
              )}
            />
            {t(`priority.${item.priority}`)}
          </Badge>
          {item.dueDate && (
            <Badge
              variant="outline"
              className={cn(
                "gap-1",
                item.isOverdue && "border-destructive/40 text-destructive",
              )}
            >
              <Clock className="h-2.5 w-2.5" />
              {t("fields.due")} {item.dueDate}
            </Badge>
          )}
        </div>
      </SheetHeader>

      <ActionBar
        item={item}
        spaceId={spaceId}
        organizationId={organizationId}
        permissionState={permissionState}
        t={t}
        tApiError={tApiError}
      />

      {item.isBlocked && item.blockedReason && (
        <div className="border-b border-border bg-warning/10 px-5 py-2.5">
          <div className="flex items-start gap-2">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
            <div className="text-xs">
              <span className="font-medium text-warning">
                {t("blocked.label")}
              </span>
              <span className="ml-2 text-foreground/80">
                {item.blockedReason}
              </span>
            </div>
          </div>
        </div>
      )}

      <Tabs
        defaultValue="detail"
        className="flex flex-1 flex-col overflow-hidden"
      >
        <TabsList className="px-5">
          <TabsTrigger value="detail" data-testid="task-detail-tab">
            {t("tabs.detail")}
          </TabsTrigger>
          <TabsTrigger
            value="comments"
            className="gap-1.5"
            data-testid="task-comments-tab"
          >
            <MessageSquare className="h-3 w-3" />
            {t("tabs.comments")}
          </TabsTrigger>
          <TabsTrigger
            value="attachments"
            className="gap-1.5"
            data-testid="task-attachments-tab"
          >
            <Paperclip className="h-3 w-3" />
            {t("tabs.attachments")}
          </TabsTrigger>
          <TabsTrigger
            value="timeline"
            className="gap-1.5"
            data-testid="task-timeline-tab"
          >
            <Clock className="h-3 w-3" />
            {t("tabs.timeline")}
          </TabsTrigger>
          <TabsTrigger
            value="links"
            className="gap-1.5"
            data-testid="task-links-tab"
          >
            <Link2 className="h-3 w-3" />
            {t("tabs.links")}
          </TabsTrigger>
        </TabsList>

        <TabsContent
          value="detail"
          data-testid="task-detail-panel"
          className="mt-0 flex-1 overflow-y-auto px-5 py-4"
        >
          <DetailTab item={item} lookup={lookup} t={t} />
        </TabsContent>

        <TabsContent value="comments" className="mt-0 flex-1 overflow-hidden">
          <CommentsTab
            item={item}
            spaceId={spaceId}
            organizationId={organizationId}
            lookup={lookup}
            canComment={permissionState.permissions?.canComment === true}
            t={t}
            tApiError={tApiError}
          />
        </TabsContent>

        <TabsContent
          value="attachments"
          data-testid="task-attachments-panel"
          className="mt-0 flex-1 overflow-y-auto"
        >
          <AttachmentsTab
            item={item}
            spaceId={spaceId}
            organizationId={organizationId}
            lookup={lookup}
            canUploadAttachment={
              permissionState.permissions?.canUploadAttachment === true
            }
            t={t}
            tApiError={tApiError}
          />
        </TabsContent>

        <TabsContent
          value="timeline"
          data-testid="task-timeline-panel"
          className="mt-0 flex-1 overflow-y-auto"
        >
          <TimelineTab
            item={item}
            spaceId={spaceId}
            organizationId={organizationId}
            t={t}
            tApiError={tApiError}
          />
        </TabsContent>

        <TabsContent
          value="links"
          data-testid="task-links-panel"
          className="mt-0 flex-1 overflow-y-auto px-5 py-4"
        >
          <LinksPanel
            item={item}
            spaceId={spaceId}
            organizationId={organizationId}
            t={t}
            tApiError={tApiError}
          />
        </TabsContent>
      </Tabs>
    </SheetContent>
  );
}

type WorkItemPermissionState = {
  error: string | null;
  fetchPermissions: () => Promise<void>;
  loading: boolean;
  permissions: PermissionSnapshot | null;
  setPermissions: (permissions: PermissionSnapshot | null) => void;
};

function useWorkItemPermissions({
  item,
  organizationId,
  spaceId,
  tApiError,
}: {
  item: Pick<WorkItemViewModel, "id" | "type">;
  organizationId?: string;
  spaceId?: string;
  tApiError: ReturnType<typeof useTranslations>;
}): WorkItemPermissionState {
  const [permissions, setPermissions] = useState<PermissionSnapshot | null>(
    null,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchPermissions = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const detail = await loadSheetDetail({ item, organizationId, spaceId });
      setPermissions(detail.permissions ?? null);
    } catch (err) {
      const key = getApiErrorMessageKey(err);
      setError(tApiError(key));
    } finally {
      setLoading(false);
    }
  }, [item, organizationId, spaceId, tApiError]);

  useEffect(() => {
    void fetchPermissions();
  }, [fetchPermissions]);

  return { error, fetchPermissions, loading, permissions, setPermissions };
}

// ---------------------------------------------------------------------------
// Action bar
// ---------------------------------------------------------------------------

function ActionBar({
  item,
  spaceId,
  organizationId,
  permissionState,
  t,
  tApiError,
}: {
  item: WorkItemViewModel;
  spaceId?: string;
  organizationId?: string;
  permissionState: WorkItemPermissionState;
  t: ReturnType<typeof useTranslations<"taskDetail">>;
  tApiError: ReturnType<typeof useTranslations>;
}) {
  const [executingId, setExecutingId] = useState<string | null>(null);
  const [executeError, setExecuteError] = useState<string | null>(null);

  const handleExecute = async (action: WorkflowActionSummary) => {
    if (!spaceId) return;

    setExecutingId(action.id);
    setExecuteError(null);

    try {
      const detail = await executeAction(
        {
          actionId: action.id,
          organizationId,
          spaceId,
          workItemId: item.id,
        },
        { formValues: {} },
      );
      permissionState.setPermissions(detail.permissions);
    } catch (err) {
      const key = getApiErrorMessageKey(err);
      setExecuteError(tApiError(key));
    } finally {
      setExecutingId(null);
    }
  };

  const actions = permissionState.permissions?.availableActions ?? [];

  return (
    <div className="flex flex-col gap-1.5 border-b border-border bg-muted/30 px-5 py-2.5">
      <div className="flex items-center gap-1.5">
        <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          {t("actions.label")}
        </span>
        <div className="ml-auto flex flex-wrap items-center justify-end gap-1.5">
          {permissionState.loading ? (
            <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              {t("actions.loading")}
            </span>
          ) : permissionState.error ? (
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              onClick={() => {
                void permissionState.fetchPermissions();
              }}
            >
              {t("actions.retry")}
            </Button>
          ) : actions.length === 0 ? (
            <span className="text-[11px] text-muted-foreground">
              {t("actions.empty")}
            </span>
          ) : (
            actions.map((action) => (
              <Button
                key={action.id}
                size="sm"
                variant="default"
                className="h-7 text-xs"
                disabled={executingId !== null}
                onClick={() => {
                  void handleExecute(action);
                }}
              >
                {executingId === action.id ? (
                  <>
                    <Loader2 className="h-3 w-3 animate-spin" />
                    {t("actions.executing")}
                  </>
                ) : (
                  action.name
                )}
              </Button>
            ))
          )}
        </div>
      </div>
      {permissionState.error && (
        <p className="text-[11px] text-destructive">
          {t("actions.loadErrorTitle")}: {permissionState.error}
        </p>
      )}
      {executeError && (
        <p className="text-[11px] text-destructive">
          {t("actions.errorTitle")}: {executeError}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Detail tab
// ---------------------------------------------------------------------------

function DetailTab({
  item,
  lookup,
  t,
}: {
  item: WorkItemViewModel;
  lookup: ReturnType<typeof useSpaceMembers>;
  t: ReturnType<typeof useTranslations<"taskDetail">>;
}) {
  // The WorkItemViewModel.assignee.name currently holds the user-id (see toMockWorkItem).
  // Resolve it through the cache when possible.
  const assigneeId = item.assignee.name || undefined;
  const assignee = displayUser(assigneeId, lookup.getMember);

  return (
    <>
      <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-[13px]">
        <FieldRow
          icon={User2}
          label={t("fields.assignee")}
          value={assignee.name}
        />
        <FieldRow
          icon={User2}
          label={t("fields.reporter")}
          value={assignee.name}
        />
        <FieldRow
          icon={GitBranch}
          label={t("fields.version")}
          value={item.versionName ?? "—"}
        />
        <FieldRow
          icon={Clock}
          label={t("fields.updated")}
          value={item.updatedAgo ?? "—"}
        />
      </div>
      <div className="mt-6 space-y-3">
        <h3 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          {t("description.title")}
        </h3>
        <p className="text-sm leading-relaxed text-muted-foreground">
          {t("description.empty")}
        </p>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Links / relations tab
// ---------------------------------------------------------------------------

function LinksPanel({
  item,
  spaceId,
  organizationId,
  t,
  tApiError,
}: {
  item: WorkItemViewModel;
  spaceId?: string;
  organizationId?: string;
  t: ReturnType<typeof useTranslations<"taskDetail">>;
  tApiError: ReturnType<typeof useTranslations>;
}) {
  const [detail, setDetail] = useState<Pick<
    WorkItemDetail,
    "versionId" | "requirementId" | "intakeItemId" | "reporterId"
  > | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const { getMember } = useSpaceMembers(spaceId, organizationId);
  const { getVersion } = useVersions(spaceId, organizationId);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErrorMessage(null);

    void (async () => {
      try {
        const result = await loadSheetDetail({ item, organizationId, spaceId });
        if (cancelled) return;
        setDetail({
          versionId: result.versionId,
          requirementId: result.requirementId,
          intakeItemId: result.intakeItemId,
          reporterId: result.reporterId,
        });
      } catch (err) {
        if (cancelled) return;
        setErrorMessage(tApiError(getApiErrorMessageKey(err)));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [item, organizationId, spaceId, tApiError]);

  if (loading) {
    return <LoadingState />;
  }
  if (errorMessage) {
    return <ErrorState message={errorMessage} />;
  }
  if (!detail) {
    return <EmptyState title={t("missingApi.title")} />;
  }

  const versionName = detail.versionId
    ? (getVersion(detail.versionId)?.name ?? truncateId(detail.versionId))
    : undefined;
  const reporter = displayUser(detail.reporterId, getMember);

  const links: { icon: typeof GitBranch; label: string; value: string }[] = [];
  if (versionName) {
    links.push({
      icon: GitBranch,
      label: t("fields.version"),
      value: versionName,
    });
  }
  if (detail.requirementId) {
    links.push({
      icon: Link2,
      label: t("fields.requirement"),
      value: truncateId(detail.requirementId),
    });
  }
  if (detail.intakeItemId) {
    links.push({
      icon: Link2,
      label: t("fields.intake"),
      value: truncateId(detail.intakeItemId),
    });
  }
  if (detail.reporterId) {
    links.push({
      icon: User2,
      label: t("fields.reporter"),
      value: reporter.name,
    });
  }

  if (links.length === 0) {
    return <EmptyState title={t("missingApi.title")} />;
  }

  return (
    <div data-testid="task-links-list" className="flex flex-col gap-2">
      {links.map((link, idx) => (
        <div key={`${link.label}-${idx}`} data-testid="task-links-item">
          <FieldRow icon={link.icon} label={link.label} value={link.value} />
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Comments tab
// ---------------------------------------------------------------------------

function CommentsTab({
  item,
  spaceId,
  organizationId,
  lookup,
  canComment,
  t,
  tApiError,
}: {
  item: WorkItemViewModel;
  spaceId?: string;
  organizationId?: string;
  lookup: ReturnType<typeof useSpaceMembers>;
  canComment: boolean;
  t: ReturnType<typeof useTranslations<"taskDetail">>;
  tApiError: ReturnType<typeof useTranslations>;
}) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const fetchComments = useCallback(async () => {
    if (!spaceId) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const result = await listComments({
        organizationId,
        spaceId,
        targetId: item.id,
        targetType: "WORK_ITEM",
      });
      setComments(result.items);
    } catch (err) {
      const key = getApiErrorMessageKey(err);
      setError(tApiError(key));
    } finally {
      setLoading(false);
    }
  }, [item.id, organizationId, spaceId, tApiError]);

  useEffect(() => {
    void fetchComments();
  }, [fetchComments]);

  const handleSubmit = async () => {
    const body = draft.trim();
    if (!body || !spaceId || !canComment) return;

    setSubmitting(true);
    setSubmitError(null);

    try {
      const created = await createComment({
        body,
        organizationId,
        spaceId,
        targetId: item.id,
        targetType: "WORK_ITEM",
      });
      setComments((prev) => [...prev, created]);
      setDraft("");
    } catch (err) {
      const key = getApiErrorMessageKey(err);
      setSubmitError(tApiError(key));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <LoadingState label={t("comments.loading")} />
        ) : error ? (
          <ErrorState
            title={t("comments.errorTitle")}
            message={error}
            retryLabel={t("comments.retry")}
            onRetry={() => {
              void fetchComments();
            }}
          />
        ) : comments.length === 0 ? (
          <EmptyState
            icon={<MessageSquare className="h-4 w-4" />}
            title={t("comments.emptyTitle")}
            description={t("comments.emptyDescription")}
          />
        ) : (
          <ul data-testid="task-comments-list" className="space-y-4 px-5 py-4">
            {comments.map((comment) => {
              const member = lookup.getMember(comment.author.id);
              const name = member?.user.name ?? comment.author.name;
              const initial = name.trim().slice(0, 1).toUpperCase() || "?";
              const avatar = member?.user.avatar ?? comment.author.avatar;

              return (
                <li
                  key={comment.id}
                  data-testid="task-comments-item"
                  className="flex gap-3"
                >
                  <Avatar className="h-7 w-7">
                    {avatar && <AvatarImage src={avatar} alt={name} />}
                    <AvatarFallback>{initial}</AvatarFallback>
                  </Avatar>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{name}</span>
                      <span className="text-[11px] text-muted-foreground">
                        {formatDateTime(comment.createdAt, "default")}
                      </span>
                    </div>
                    <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">
                      {comment.body}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {submitError && (
        <p className="border-t border-border bg-destructive/10 px-5 py-2 text-[11px] text-destructive">
          {t("comments.submitErrorTitle")}: {submitError}
        </p>
      )}
      {canComment ? (
        <div
          data-testid="task-comments-panel"
          className="flex items-center gap-2 border-t border-border px-5 py-3"
        >
          <Input
            data-testid="task-comments-input"
            placeholder={t("comments.placeholder")}
            className="flex-1"
            value={draft}
            disabled={submitting}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                void handleSubmit();
              }
            }}
          />
          <Button
            size="sm"
            data-testid="task-comments-submit"
            disabled={submitting || draft.trim().length === 0}
            onClick={() => {
              void handleSubmit();
            }}
          >
            {submitting ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Send className="h-3 w-3" />
            )}
            {submitting ? t("comments.submitting") : t("comments.submit")}
            <Kbd className="ml-1 bg-primary-foreground/20 text-primary-foreground border-primary-foreground/30">
              ⌘⏎
            </Kbd>
          </Button>
        </div>
      ) : (
        <p
          data-testid="task-comments-readonly"
          className="border-t border-border px-5 py-3 text-[11px] text-muted-foreground"
        >
          {t("comments.readonly")}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Attachments tab
// ---------------------------------------------------------------------------

function AttachmentsTab({
  item,
  spaceId,
  organizationId,
  lookup,
  canUploadAttachment,
  t,
  tApiError,
}: {
  item: WorkItemViewModel;
  spaceId?: string;
  organizationId?: string;
  lookup: ReturnType<typeof useSpaceMembers>;
  canUploadAttachment: boolean;
  t: ReturnType<typeof useTranslations<"taskDetail">>;
  tApiError: ReturnType<typeof useTranslations>;
}) {
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const fetchAttachments = useCallback(async () => {
    if (!spaceId) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const result = await listAttachments({
        organizationId,
        spaceId,
        targetId: item.id,
        targetType: "WORK_ITEM",
      });
      setAttachments(result.items);
    } catch (err) {
      const key = getApiErrorMessageKey(err);
      setError(tApiError(key));
    } finally {
      setLoading(false);
    }
  }, [item.id, organizationId, spaceId, tApiError]);

  useEffect(() => {
    void fetchAttachments();
  }, [fetchAttachments]);

  const handleFileChange = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (!file) {
        return;
      }
      if (!canUploadAttachment) {
        return;
      }
      setUploadError(null);
      setUploading(true);
      try {
        await uploadAttachment({
          existingAttachmentCount: attachments.length,
          file,
          targetId: item.id,
          targetType: "WORK_ITEM",
        });
        await fetchAttachments();
      } catch (err) {
        if (err instanceof AttachmentUploadError) {
          setUploadError(tApiError(`api.error.attachment.${err.code}`));
        } else {
          setUploadError(tApiError(getApiErrorMessageKey(err)));
        }
      } finally {
        setUploading(false);
      }
    },
    [
      attachments.length,
      canUploadAttachment,
      fetchAttachments,
      item.id,
      tApiError,
    ],
  );

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border px-5 py-2.5">
        <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          {t("tabs.attachments")}
        </span>
        {canUploadAttachment ? (
          <div className="flex items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              data-testid="task-attachments-file-input"
              className="hidden"
              onChange={handleFileChange}
              disabled={uploading || !spaceId}
            />
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              data-testid="task-attachments-upload-button"
              disabled={uploading || !spaceId}
              onClick={() => fileInputRef.current?.click()}
            >
              {uploading ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Paperclip className="h-3 w-3" />
              )}
              {t("attachments.uploadAction")}
            </Button>
          </div>
        ) : (
          <span
            data-testid="task-attachments-readonly"
            className="text-[11px] text-muted-foreground"
          >
            {t("attachments.readonly")}
          </span>
        )}
      </div>
      {uploadError && (
        <p className="border-b border-border bg-destructive/10 px-5 py-2 text-[11px] text-destructive">
          {uploadError}
        </p>
      )}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <LoadingState label={t("attachments.loading")} />
        ) : error ? (
          <ErrorState
            title={t("attachments.errorTitle")}
            message={error}
            retryLabel={t("attachments.retry")}
            onRetry={() => {
              void fetchAttachments();
            }}
          />
        ) : attachments.length === 0 ? (
          <EmptyState
            icon={<Paperclip className="h-4 w-4" />}
            title={t("attachments.emptyTitle")}
            description={t("attachments.emptyDescription")}
          />
        ) : (
          <ul
            data-testid="task-attachments-list"
            className="divide-y divide-border"
          >
            {attachments.map((attachment) => {
              const uploader = displayUser(
                attachment.uploadedById,
                lookup.getMember,
              );

              return (
                <li
                  key={attachment.id}
                  data-testid="task-attachments-item"
                  className="flex items-center gap-3 px-5 py-2.5"
                >
                  <Paperclip className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <div className="flex-1 min-w-0">
                    <p className="truncate text-[13px] font-medium text-foreground">
                      {attachment.fileName}
                    </p>
                    <div className="mt-0.5 flex items-center gap-3 text-[11px] text-muted-foreground">
                      <span>
                        {t("attachments.size")}: {formatBytes(attachment.size)}
                      </span>
                      <span>
                        {t("attachments.uploadedBy")}: {uploader.name}
                      </span>
                      <span>
                        {formatDateTime(attachment.createdAt, "default")}
                      </span>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Timeline tab
// ---------------------------------------------------------------------------

function TimelineTab({
  item,
  spaceId,
  organizationId,
  t,
  tApiError,
}: {
  item: WorkItemViewModel;
  spaceId?: string;
  organizationId?: string;
  t: ReturnType<typeof useTranslations<"taskDetail">>;
  tApiError: ReturnType<typeof useTranslations>;
}) {
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchEvents = useCallback(async () => {
    if (!spaceId) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const result = await listTimeline({
        organizationId,
        spaceId,
        targetId: item.id,
        targetType: "WORK_ITEM",
      });
      setEvents(result.items);
    } catch (err) {
      const key = getApiErrorMessageKey(err);
      setError(tApiError(key));
    } finally {
      setLoading(false);
    }
  }, [item.id, organizationId, spaceId, tApiError]);

  useEffect(() => {
    void fetchEvents();
  }, [fetchEvents]);

  if (loading) {
    return <LoadingState label={t("timeline.loading")} />;
  }

  if (error) {
    return (
      <ErrorState
        title={t("timeline.errorTitle")}
        message={error}
        retryLabel={t("timeline.retry")}
        onRetry={() => {
          void fetchEvents();
        }}
      />
    );
  }

  if (events.length === 0) {
    return (
      <EmptyState
        icon={<Clock className="h-4 w-4" />}
        title={t("timeline.emptyTitle")}
        description={t("timeline.emptyDescription")}
      />
    );
  }

  return (
    <ul data-testid="task-timeline-list" className="space-y-3 px-5 py-4">
      {events.map((event) => {
        const initial =
          event.actor.name.trim().slice(0, 1).toUpperCase() || "?";

        return (
          <li
            key={event.id}
            data-testid="task-timeline-item"
            className="flex gap-3"
          >
            <Avatar className="h-7 w-7">
              {event.actor.avatar && (
                <AvatarImage src={event.actor.avatar} alt={event.actor.name} />
              )}
              <AvatarFallback>{initial}</AvatarFallback>
            </Avatar>
            <div className="flex-1 text-[13px]">
              <div>
                <span className="font-medium">{event.actor.name}</span>
                <span className="text-muted-foreground"> {event.title} </span>
                {event.detail && (
                  <span className="font-mono text-[12px] text-foreground">
                    {event.detail}
                  </span>
                )}
              </div>
              <div className="mt-0.5 text-[11px] text-muted-foreground">
                {formatDateTime(event.createdAt, "default")}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

// ---------------------------------------------------------------------------

function FieldRow({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof User2;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <span className="ml-auto truncate font-medium text-foreground">
        {value}
      </span>
    </div>
  );
}

export type { Props as TaskDetailSheetProps };
