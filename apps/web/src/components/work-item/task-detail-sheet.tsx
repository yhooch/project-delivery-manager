"use client";

import type {
  ActionFormFieldSummary,
  Attachment,
  BugView,
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
  Download,
  Eye,
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
import { toExecuteActionRequest } from "../../lib/action-forms";
import {
  AttachmentUploadError,
  getAttachmentDownloadUrl,
  listAttachments,
  uploadAttachment,
} from "../../lib/attachment-service";
import { executeAction } from "../../lib/action-service";
import { getBug } from "../../lib/bug-service";
import { createComment, listComments } from "../../lib/comment-service";
import { listTimeline } from "../../lib/timeline-service";
import { cn } from "../../lib/utils";
import { type WorkItemViewModel } from "../../lib/v2/work-item-view-model";
import {
  useRelationTitle,
  useSpaceMembers,
  useVersions,
} from "../../lib/v2/lookups";
import { getWorkItem } from "../../lib/work-item-service";

import { useSession } from "../providers/session-provider";
import { Avatar, AvatarFallback, AvatarImage } from "../ui/avatar";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Kbd } from "../ui/kbd";
import { Label } from "../ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "../ui/sheet";
import { StatusBadge } from "../ui/status-badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";
import { Textarea } from "../ui/textarea";
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
  /**
   * Fired after the user mutates the item (executes a workflow action or
   * posts a comment). Callers use this to refresh upstream lists/board
   * views once the sheet detail mutates. Safe to omit.
   */
  onChanged?: () => void;
};

type ContextualWorkItemViewModel = WorkItemViewModel & {
  organizationId?: string;
  spaceId?: string;
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

type SheetDetail = (WorkItemDetail | BugView) & {
  permissions?: PermissionSnapshot;
};

function getWorkItemPermissionRequestKey({
  item,
  organizationId,
  spaceId,
}: {
  item: Pick<WorkItemViewModel, "id" | "type">;
  organizationId?: string;
  spaceId?: string;
}): string {
  return `${item.type}:${item.id}:${organizationId ?? ""}:${spaceId ?? ""}`;
}

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
  onChanged,
}: Props) {
  const t = useTranslations("taskDetail");
  const tApiError = useTranslations();
  const { currentSpace, currentOrganization, session } = useSession();

  const itemContext = item as ContextualWorkItemViewModel | null;
  const spaceId = spaceIdProp ?? itemContext?.spaceId ?? currentSpace?.id;
  const organizationId =
    organizationIdProp ??
    itemContext?.organizationId ??
    currentOrganization?.id ??
    currentSpace?.organizationId;
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
        onChanged={onChanged}
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
  onChanged?: () => void;
};

function TaskDetailSheetBody({
  item,
  spaceId,
  organizationId,
  currentUserId: _currentUserId,
  t,
  tApiError,
  onChanged,
}: BodyProps) {
  const isBug = item.type === "BUG";
  const lookup = useSpaceMembers(spaceId, organizationId);
  const { getVersion } = useVersions(spaceId, organizationId);
  const permissionState = useWorkItemPermissions({
    item,
    organizationId,
    spaceId,
    tApiError,
  });
  const detail = permissionState.detail;
  const priority = detail?.priority ?? item.priority;
  const statusCategory = detail?.statusCategory ?? item.statusCategory;
  const statusLabel = detail
    ? tApiError(
        `${isBug ? "bugs" : "workItems"}.statusCategory.${statusCategory}`,
      )
    : item.statusLabel;
  const versionName = detail?.versionId
    ? (getVersion(detail.versionId)?.name ?? truncateId(detail.versionId))
    : item.versionName;
  const dueDate = detail?.dueDate
    ? formatDateTime(detail.dueDate, "default")
    : item.dueDate;
  const isBlocked = detail
    ? statusCategory === "WAITING" || Boolean(detail.blockedAt)
    : item.isBlocked;
  const blockedReason = detail?.blockedReason ?? item.blockedReason;

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
          <span className="truncate">{versionName}</span>
        </div>
        <SheetTitle className="mt-1 text-base leading-snug">
          {detail?.title ?? item.title}
        </SheetTitle>
        <SheetDescription className="sr-only">
          {isBug ? t("sheetDescription.bug") : t("sheetDescription.task")}
        </SheetDescription>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <StatusBadge category={statusCategory} label={statusLabel} />
          <Badge
            variant="outline"
            className={cn("gap-1", priorityColor[priority])}
          >
            <span
              className={cn(
                "h-1.5 w-1.5 rounded-full",
                priority === "URGENT" && "bg-destructive",
                priority === "HIGH" && "bg-warning",
                priority === "MEDIUM" && "bg-info",
                priority === "LOW" && "bg-muted-foreground",
              )}
            />
            {t(`priority.${priority}`)}
          </Badge>
          {dueDate && (
            <Badge
              variant="outline"
              className={cn(
                "gap-1",
                item.isOverdue && "border-destructive/40 text-destructive",
              )}
            >
              <Clock className="h-2.5 w-2.5" />
              {t("fields.due")} {dueDate}
            </Badge>
          )}
        </div>
      </SheetHeader>

      <ActionBar
        item={item}
        spaceId={spaceId}
        organizationId={organizationId}
        permissionState={permissionState}
        lookup={lookup}
        t={t}
        tApiError={tApiError}
        onChanged={onChanged}
      />

      {isBlocked && blockedReason && (
        <div className="border-b border-border bg-warning/10 px-5 py-2.5">
          <div className="flex items-start gap-2">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
            <div className="text-xs">
              <span className="font-medium text-warning">
                {t("blocked.label")}
              </span>
              <span className="ml-2 text-foreground/80">{blockedReason}</span>
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
          <DetailTab
            item={item}
            detail={detail}
            lookup={lookup}
            t={t}
            tRoot={tApiError}
            versionName={versionName}
          />
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
            onChanged={onChanged}
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
            detail={detail}
            detailError={permissionState.error}
            detailLoading={permissionState.loading}
            spaceId={spaceId}
            organizationId={organizationId}
            t={t}
            tApiError={tApiError}
            onRetry={() => {
              void permissionState.fetchPermissions();
            }}
          />
        </TabsContent>
      </Tabs>
    </SheetContent>
  );
}

type WorkItemPermissionState = {
  detail: SheetDetail | null;
  error: string | null;
  fetchPermissions: () => Promise<void>;
  loading: boolean;
  permissions: PermissionSnapshot | null;
  setPermissions: (permissions: PermissionSnapshot | null) => void;
};

type WorkItemPermissionLoadState = {
  detail: SheetDetail | null;
  error: string | null;
  loading: boolean;
  permissions: PermissionSnapshot | null;
  requestKey: string;
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
  const requestKey = getWorkItemPermissionRequestKey({
    item,
    organizationId,
    spaceId,
  });
  const latestRequestKeyRef = useRef(requestKey);
  const requestSeqRef = useRef(0);
  const [state, setState] = useState<WorkItemPermissionLoadState>(() => ({
    detail: null,
    error: null,
    loading: false,
    permissions: null,
    requestKey,
  }));

  latestRequestKeyRef.current = requestKey;

  const setPermissions = useCallback(
    (permissions: PermissionSnapshot | null) => {
      setState((current) => {
        if (current.requestKey === requestKey) {
          return { ...current, permissions };
        }

        return {
          detail: null,
          error: null,
          loading: false,
          permissions,
          requestKey,
        };
      });
    },
    [requestKey],
  );

  const fetchPermissions = useCallback(async () => {
    requestSeqRef.current += 1;
    const requestSeq = requestSeqRef.current;
    const nextRequestKey = requestKey;
    const requestItem = { id: item.id, type: item.type };

    setState({
      detail: null,
      error: null,
      loading: true,
      permissions: null,
      requestKey: nextRequestKey,
    });

    const isLatestRequest = () =>
      requestSeqRef.current === requestSeq &&
      latestRequestKeyRef.current === nextRequestKey;

    try {
      const detail = await loadSheetDetail({
        item: requestItem,
        organizationId,
        spaceId,
      });
      if (!isLatestRequest()) return;

      setState({
        detail,
        error: null,
        loading: false,
        permissions: detail.permissions ?? null,
        requestKey: nextRequestKey,
      });
    } catch (err) {
      if (!isLatestRequest()) return;

      const key = getApiErrorMessageKey(err);
      setState({
        detail: null,
        error: tApiError(key),
        loading: false,
        permissions: null,
        requestKey: nextRequestKey,
      });
    }
  }, [item.id, item.type, organizationId, requestKey, spaceId, tApiError]);

  useEffect(() => {
    void fetchPermissions();
  }, [fetchPermissions]);

  const currentState =
    state.requestKey === requestKey
      ? state
      : {
          detail: null,
          error: null,
          loading: false,
          permissions: null,
        };

  return {
    detail: currentState.detail,
    error: currentState.error,
    fetchPermissions,
    loading: currentState.loading,
    permissions: currentState.permissions,
    setPermissions,
  };
}

// ---------------------------------------------------------------------------
// Action bar
// ---------------------------------------------------------------------------

function ActionBar({
  item,
  spaceId,
  organizationId,
  permissionState,
  lookup,
  t,
  tApiError,
  onChanged,
}: {
  item: WorkItemViewModel;
  spaceId?: string;
  organizationId?: string;
  permissionState: WorkItemPermissionState;
  lookup: ReturnType<typeof useSpaceMembers>;
  t: ReturnType<typeof useTranslations<"taskDetail">>;
  tApiError: ReturnType<typeof useTranslations>;
  onChanged?: () => void;
}) {
  const [executingId, setExecutingId] = useState<string | null>(null);
  const [executeError, setExecuteError] = useState<string | null>(null);
  const [selectedAction, setSelectedAction] =
    useState<WorkflowActionSummary | null>(null);
  const [commentDraft, setCommentDraft] = useState("");
  const [formDraft, setFormDraft] = useState<Record<string, string>>({});

  const resetActionForm = useCallback(() => {
    setSelectedAction(null);
    setCommentDraft("");
    setFormDraft({});
  }, []);

  const beginAction = (action: WorkflowActionSummary) => {
    setExecuteError(null);

    if (!action.requiresComment && action.formFields.length === 0) {
      void handleExecute(action, { formValues: {} });
      return;
    }

    setSelectedAction(action);
    setCommentDraft("");
    setFormDraft(
      Object.fromEntries(action.formFields.map((field) => [field.key, ""])),
    );
  };

  const handleExecute = async (
    action: WorkflowActionSummary,
    input: { comment?: string; formValues: Record<string, unknown> },
  ) => {
    if (!spaceId) return;

    let payload;
    try {
      payload = toExecuteActionRequest(action, input);
    } catch {
      setExecuteError(tApiError("errors.api.WORKFLOW_ACTION_FORM_INVALID"));
      return;
    }

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
        payload,
      );
      permissionState.setPermissions(detail.permissions);
      await permissionState.fetchPermissions();
      resetActionForm();
      onChanged?.();
    } catch (err) {
      const key = getApiErrorMessageKey(err);
      setExecuteError(tApiError(key));
    } finally {
      setExecutingId(null);
    }
  };

  const actions = permissionState.permissions?.availableActions ?? [];
  const selectedActionStillAvailable = Boolean(
    selectedAction && actions.some((action) => action.id === selectedAction.id),
  );

  useEffect(() => {
    if (selectedAction && !selectedActionStillAvailable) {
      resetActionForm();
    }
  }, [resetActionForm, selectedAction, selectedActionStillAvailable]);

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
                  beginAction(action);
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
      {selectedAction && selectedActionStillAvailable && (
        <ActionExecutionForm
          action={selectedAction}
          commentDraft={commentDraft}
          executing={executingId === selectedAction.id}
          formDraft={formDraft}
          lookup={lookup}
          onCancel={resetActionForm}
          onCommentChange={setCommentDraft}
          onFieldChange={(key, value) => {
            setFormDraft((current) => ({ ...current, [key]: value }));
          }}
          onSubmit={() => {
            void handleExecute(selectedAction, {
              comment: commentDraft,
              formValues: formDraft,
            });
          }}
          t={t}
          tRoot={tApiError}
        />
      )}
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

function ActionExecutionForm({
  action,
  commentDraft,
  executing,
  formDraft,
  lookup,
  onCancel,
  onCommentChange,
  onFieldChange,
  onSubmit,
  t,
  tRoot,
}: {
  action: WorkflowActionSummary;
  commentDraft: string;
  executing: boolean;
  formDraft: Record<string, string>;
  lookup: ReturnType<typeof useSpaceMembers>;
  onCancel: () => void;
  onCommentChange: (value: string) => void;
  onFieldChange: (key: string, value: string) => void;
  onSubmit: () => void;
  t: ReturnType<typeof useTranslations<"taskDetail">>;
  tRoot: ReturnType<typeof useTranslations>;
}) {
  return (
    <div
      data-testid="task-action-form"
      className="rounded-md border border-border bg-background p-3"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {action.formFields.map((field) => (
          <ActionFormFieldControl
            key={field.id}
            field={field}
            lookup={lookup}
            value={formDraft[field.key] ?? ""}
            onChange={(value) => onFieldChange(field.key, value)}
          />
        ))}
        {action.requiresComment && (
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label htmlFor={`task-action-comment-${action.id}`}>
              {tRoot("tasks.workflowActions.comment")}
            </Label>
            <Textarea
              id={`task-action-comment-${action.id}`}
              data-testid="task-action-comment"
              value={commentDraft}
              maxLength={4000}
              rows={3}
              placeholder={t("comments.placeholder")}
              disabled={executing}
              onChange={(event) => onCommentChange(event.target.value)}
            />
          </div>
        )}
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 text-xs"
          disabled={executing}
          onClick={onCancel}
        >
          {tRoot("tasks.dialog.actions.cancel")}
        </Button>
        <Button
          type="button"
          size="sm"
          className="h-7 text-xs"
          disabled={executing}
          onClick={onSubmit}
        >
          {executing ? (
            <>
              <Loader2 className="h-3 w-3 animate-spin" />
              {t("actions.executing")}
            </>
          ) : (
            action.name
          )}
        </Button>
      </div>
    </div>
  );
}

function ActionFormFieldControl({
  field,
  lookup,
  onChange,
  value,
}: {
  field: ActionFormFieldSummary;
  lookup: ReturnType<typeof useSpaceMembers>;
  onChange: (value: string) => void;
  value: string;
}) {
  const id = `task-action-field-${field.id}`;
  const label = field.required ? `${field.label} *` : field.label;

  if (field.fieldType === "TEXTAREA") {
    return (
      <div className="flex flex-col gap-1.5 sm:col-span-2">
        <Label htmlFor={id}>{label}</Label>
        <Textarea
          id={id}
          data-testid="task-action-field"
          data-field-key={field.key}
          value={value}
          rows={3}
          onChange={(event) => onChange(event.target.value)}
        />
      </div>
    );
  }

  if (field.fieldType === "SELECT") {
    return (
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={id}>{label}</Label>
        <select
          id={id}
          data-testid="task-action-field"
          data-field-key={field.key}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <option value="" />
          {(field.options ?? []).map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </div>
    );
  }

  if (field.fieldType === "USER" && lookup.members.length > 0) {
    return (
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={id}>{label}</Label>
        <select
          id={id}
          data-testid="task-action-field"
          data-field-key={field.key}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <option value="" />
          {lookup.members.map((member) => (
            <option key={member.userId} value={member.userId}>
              {member.user.name || member.user.username}
            </option>
          ))}
        </select>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        data-testid="task-action-field"
        data-field-key={field.key}
        type={
          field.fieldType === "DATE"
            ? "date"
            : field.fieldType === "NUMBER"
              ? "number"
              : "text"
        }
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Detail tab
// ---------------------------------------------------------------------------

function DetailTab({
  item,
  detail,
  lookup,
  t,
  tRoot,
  versionName,
}: {
  item: WorkItemViewModel;
  detail: SheetDetail | null;
  lookup: ReturnType<typeof useSpaceMembers>;
  t: ReturnType<typeof useTranslations<"taskDetail">>;
  tRoot: ReturnType<typeof useTranslations>;
  versionName?: string;
}) {
  const assigneeId = (detail?.assigneeId ?? item.assignee.name) || undefined;
  const assignee = displayUser(assigneeId, lookup.getMember);
  const reporter = displayUser(detail?.reporterId, lookup.getMember);
  const updatedAt = detail?.lastActionAt ?? detail?.lastStatusChangedAt;
  const bugDetail = isBugSheetDetail(detail) ? detail.bugDetail : null;

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
          value={reporter.name}
        />
        <FieldRow
          icon={GitBranch}
          label={t("fields.version")}
          value={versionName ?? "—"}
        />
        <FieldRow
          icon={Clock}
          label={t("fields.updated")}
          value={
            updatedAt
              ? formatDateTime(updatedAt, "default")
              : (item.updatedAgo ?? "—")
          }
        />
      </div>
      <div className="mt-6 space-y-3">
        <h3 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          {t("description.title")}
        </h3>
        <p className="text-sm leading-relaxed text-muted-foreground">
          {detail?.description?.trim() || t("description.empty")}
        </p>
      </div>
      {bugDetail && (
        <div className="mt-6 space-y-3">
          <h3 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            {tRoot("bugs.bugFields.title")}
          </h3>
          <DetailTextBlock
            label={tRoot("bugs.bugFields.stepsToReproduce")}
            value={bugDetail.stepsToReproduce}
            empty={tRoot("bugs.bugFields.empty")}
          />
          <DetailTextBlock
            label={tRoot("bugs.bugFields.expectedResult")}
            value={bugDetail.expectedResult}
            empty={tRoot("bugs.bugFields.empty")}
          />
          <DetailTextBlock
            label={tRoot("bugs.bugFields.actualResult")}
            value={bugDetail.actualResult}
            empty={tRoot("bugs.bugFields.empty")}
          />
          <DetailTextBlock
            label={tRoot("bugs.bugFields.fixNote")}
            value={bugDetail.fixNote}
            empty={tRoot("bugs.bugFields.empty")}
          />
          <DetailTextBlock
            label={tRoot("bugs.bugFields.regressionResult")}
            value={bugDetail.regressionResult}
            empty={tRoot("bugs.bugFields.empty")}
          />
          <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-[13px]">
            <FieldRow
              icon={User2}
              label={tRoot("bugs.form.regressionBy")}
              value={
                bugDetail.regressionBy
                  ? displayUser(bugDetail.regressionBy, lookup.getMember).name
                  : tRoot("bugs.bugFields.empty")
              }
            />
            <FieldRow
              icon={Clock}
              label={tRoot("bugs.form.regressionAt")}
              value={
                bugDetail.regressionAt
                  ? formatDateTime(bugDetail.regressionAt, "default")
                  : tRoot("bugs.bugFields.empty")
              }
            />
          </div>
        </div>
      )}
    </>
  );
}

function isBugSheetDetail(detail: SheetDetail | null): detail is BugView {
  return Boolean(detail && detail.type === "BUG" && "bugDetail" in detail);
}

function DetailTextBlock({
  empty,
  label,
  value,
}: {
  empty: string;
  label: string;
  value?: string;
}) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">
        {value?.trim() || empty}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Links / relations tab
// ---------------------------------------------------------------------------

function LinksPanel({
  detail,
  detailError,
  detailLoading,
  spaceId,
  organizationId,
  t,
  tApiError,
  onRetry,
}: {
  detail: SheetDetail | null;
  detailError: string | null;
  detailLoading: boolean;
  spaceId?: string;
  organizationId?: string;
  t: ReturnType<typeof useTranslations<"taskDetail">>;
  tApiError: ReturnType<typeof useTranslations>;
  onRetry: () => void;
}) {
  const { getMember } = useSpaceMembers(spaceId, organizationId);
  const { getVersion } = useVersions(spaceId, organizationId);
  const requirementTitle = useRelationTitle(
    "requirement",
    detail?.requirementId,
    spaceId,
    organizationId,
  );
  const intakeTitle = useRelationTitle(
    "intake",
    detail?.intakeItemId,
    spaceId,
    organizationId,
  );
  const relatedTaskTitle = useRelationTitle(
    "workItem",
    isBugSheetDetail(detail) ? detail.bugDetail.relatedTaskId : undefined,
    spaceId,
    organizationId,
  );

  if (detailLoading && !detail) {
    return <LoadingState />;
  }
  if (detailError) {
    return <ErrorState message={detailError} onRetry={onRetry} />;
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
      value: relationTitleValue(requirementTitle, t),
    });
  }
  if (detail.intakeItemId) {
    links.push({
      icon: Link2,
      label: t("fields.intake"),
      value: relationTitleValue(intakeTitle, t),
    });
  }
  if (isBugSheetDetail(detail) && detail.bugDetail.relatedTaskId) {
    links.push({
      icon: Link2,
      label: tApiError("bugs.form.relatedTask"),
      value: relationTitleValue(relatedTaskTitle, t),
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

function relationTitleValue(
  result: ReturnType<typeof useRelationTitle>,
  t: ReturnType<typeof useTranslations<"taskDetail">>,
): string {
  if (result.title) {
    return result.title;
  }
  if (result.loading) {
    return t("links.loading");
  }
  return t("links.unavailable");
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
  onChanged,
}: {
  item: WorkItemViewModel;
  spaceId?: string;
  organizationId?: string;
  lookup: ReturnType<typeof useSpaceMembers>;
  canComment: boolean;
  t: ReturnType<typeof useTranslations<"taskDetail">>;
  tApiError: ReturnType<typeof useTranslations>;
  onChanged?: () => void;
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
      onChanged?.();
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
  const [attachmentActionError, setAttachmentActionError] = useState<
    string | null
  >(null);
  const [uploading, setUploading] = useState(false);
  const [openingAttachmentId, setOpeningAttachmentId] = useState<string | null>(
    null,
  );
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
      setAttachmentActionError(null);
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

  const handleAttachmentAction = useCallback(
    async (attachment: Attachment, action: "download" | "preview") => {
      if (!spaceId) {
        return;
      }

      const actionId = `${action}:${attachment.id}`;
      setAttachmentActionError(null);
      setOpeningAttachmentId(actionId);

      try {
        const result = await getAttachmentDownloadUrl({
          attachmentId: attachment.id,
          organizationId,
          spaceId,
        });

        if (action === "preview") {
          window.open(result.downloadUrl, "_blank", "noopener,noreferrer");
        } else {
          triggerAttachmentDownload(result.downloadUrl, attachment.fileName);
        }
      } catch (err) {
        const key = getApiErrorMessageKey(err);
        setAttachmentActionError(tApiError(key));
      } finally {
        setOpeningAttachmentId(null);
      }
    },
    [organizationId, spaceId, tApiError],
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
      {(uploadError || attachmentActionError) && (
        <p className="border-b border-border bg-destructive/10 px-5 py-2 text-[11px] text-destructive">
          {uploadError ?? attachmentActionError}
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
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2"
                      data-testid="task-attachments-preview-button"
                      data-id={attachment.id}
                      aria-label={t("attachments.previewFile", {
                        fileName: attachment.fileName,
                      })}
                      title={t("attachments.previewFile", {
                        fileName: attachment.fileName,
                      })}
                      disabled={openingAttachmentId !== null || !spaceId}
                      onClick={() => {
                        void handleAttachmentAction(attachment, "preview");
                      }}
                    >
                      {openingAttachmentId === `preview:${attachment.id}` ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Eye className="h-3.5 w-3.5" />
                      )}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2"
                      data-testid="task-attachments-download-button"
                      data-id={attachment.id}
                      aria-label={t("attachments.downloadFile", {
                        fileName: attachment.fileName,
                      })}
                      title={t("attachments.downloadFile", {
                        fileName: attachment.fileName,
                      })}
                      disabled={openingAttachmentId !== null || !spaceId}
                      onClick={() => {
                        void handleAttachmentAction(attachment, "download");
                      }}
                    >
                      {openingAttachmentId === `download:${attachment.id}` ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Download className="h-3.5 w-3.5" />
                      )}
                    </Button>
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

function triggerAttachmentDownload(
  downloadUrl: string,
  fileName: string,
): void {
  const anchor = document.createElement("a");
  anchor.href = downloadUrl;
  anchor.download = fileName;
  anchor.rel = "noopener noreferrer";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
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
