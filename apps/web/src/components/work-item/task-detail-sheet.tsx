"use client";

import type {
  ActionFormFieldSummary,
  Attachment,
  BugView,
  BugSeverity,
  Comment,
  IntakeItem,
  PermissionSnapshot,
  Priority,
  Requirement,
  TimelineEvent,
  WorkItem,
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
  Pencil,
  Send,
  User2,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type React from "react";

import { getApiErrorMessageKey } from "../../lib/api-error-messages";
import { ApiClientError } from "../../lib/api-client";
import { toExecuteActionRequest } from "../../lib/action-forms";
import {
  AttachmentUploadError,
  getAttachmentDownloadUrl,
  listAttachments,
  uploadAttachment,
} from "../../lib/attachment-service";
import { executeAction } from "../../lib/action-service";
import { toUpdateBugRequest } from "../../lib/bug-forms";
import { getBug, updateBug } from "../../lib/bug-service";
import { createComment, listComments } from "../../lib/comment-service";
import { listIntakeItems } from "../../lib/intake-service";
import { listRequirements } from "../../lib/requirement-service";
import {
  realtimeContextIncludesTarget,
  resolveRefreshMode,
  shouldShowBlockingRefreshState,
  shouldSurfaceRefreshError,
  useRealtimeInvalidation,
  type RefreshModeOptions,
} from "../../lib/realtime";
import { listTimeline } from "../../lib/timeline-service";
import { cn } from "../../lib/utils";
import {
  toWorkItemListViewModel,
  type WorkItemViewModel,
} from "../../lib/v2/work-item-view-model";
import {
  useRelationTitle,
  useSpaceMembers,
  useVersions,
  useWorkflowStateLookup,
} from "../../lib/v2/lookups";
import {
  clearIncompatibleTraceSelection,
  filterTraceOptionsByVersion,
  getTraceVersionCascadeConfirmLabels,
  inheritVersionFromTraceOption,
  isTraceVersionCascadeRequiredError,
  traceVersionCascadeConfirmMessage,
} from "../../lib/versioned-trace-linking";
import { toUpdateTaskRequest } from "../../lib/work-item-forms";
import {
  getWorkItem,
  listWorkItems,
  updateWorkItem,
} from "../../lib/work-item-service";
import {
  translateExceptionReason,
  translateWorkflowActionName,
  translateWorkflowFieldLabel,
  translateWorkflowSelectOption,
  translateWorkflowStateName,
} from "../../lib/workflow-display";
import { Link } from "../../i18n/routing";

import { useSession } from "../providers/session-provider";
import { IntakeDetailSheet } from "../intake/intake-detail-sheet";
import { ObjectTagAssignmentField } from "../tag";
import { TimelineEventItem } from "../timeline/timeline-event-item";
import { TraceVersionCascadeConfirmDialog } from "../trace-version-cascade-confirm-dialog";
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
import { SelectMenu } from "../ui/select-menu";
import { EmptyState, ErrorState, LoadingState } from "../v2/states";

const priorityColor: Record<WorkItemViewModel["priority"], string> = {
  LOW: "text-muted-foreground",
  MEDIUM: "text-info",
  HIGH: "text-warning",
  URGENT: "text-destructive",
};

const TASK_PRIORITIES: Priority[] = ["LOW", "MEDIUM", "HIGH", "URGENT"];
const BUG_SEVERITIES: BugSeverity[] = [
  "BLOCKER",
  "CRITICAL",
  "MAJOR",
  "MINOR",
  "TRIVIAL",
];
const WORK_ITEM_DETAIL_REALTIME_KEYS = [
  "work-item-list",
  "bug-list",
  "timeline",
  "comments",
  "attachments",
] as const;
const WORK_ITEM_COMMENTS_REALTIME_KEYS = ["comments"] as const;
const WORK_ITEM_ATTACHMENTS_REALTIME_KEYS = ["attachments"] as const;

type Props = {
  item: WorkItemViewModel | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Incremented by list shortcuts when the sheet should move focus to the
   * workflow action area. Normal opens should leave this at 0/undefined.
   */
  actionFocusRequest?: number;
  /** Best-effort workflow action preselection for action-todo shortcuts. */
  preferredActionId?: string;
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
 * neutral fallback so missing lookup data never exposes raw ids.
 */
function displayUser(
  userId: string | undefined,
  getMember: (id: string) => { user: { name: string } } | undefined,
): { name: string; initial: string } {
  if (!userId) {
    return { name: "—", initial: "?" };
  }

  const member = getMember(userId);
  const name = member?.user.name ?? missingLookupLabel(userId);
  const initial = name.trim().slice(0, 1).toUpperCase() || "?";
  return { name, initial };
}

function missingLookupLabel(_id: string): string {
  return "—";
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

function toDateInputValue(value: string | undefined): string {
  if (!value) {
    return "";
  }

  try {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return "";
    }
    return date.toISOString().slice(0, 10);
  } catch {
    return "";
  }
}

type SheetDetail = (WorkItemDetail | BugView) & {
  permissions?: PermissionSnapshot;
};

type PendingTraceCascadeConfirm =
  | {
      message: string;
      request: ReturnType<typeof toUpdateTaskRequest>;
      targetType: "TASK";
    }
  | {
      message: string;
      request: ReturnType<typeof toUpdateBugRequest>;
      targetType: "BUG";
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

function getWorkItemSubresourceRequestKey({
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
  actionFocusRequest,
  item,
  open,
  onOpenChange,
  preferredActionId,
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
        open={open}
        actionFocusRequest={actionFocusRequest}
        preferredActionId={preferredActionId}
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
  open: boolean;
  actionFocusRequest?: number;
  preferredActionId?: string;
  spaceId?: string;
  organizationId?: string;
  currentUserId?: string;
  t: ReturnType<typeof useTranslations<"taskDetail">>;
  tApiError: ReturnType<typeof useTranslations>;
  onChanged?: () => void;
};

function TaskDetailSheetBody({
  actionFocusRequest,
  item,
  open,
  preferredActionId,
  spaceId,
  organizationId,
  currentUserId: _currentUserId,
  t,
  tApiError,
  onChanged,
}: BodyProps) {
  const locale = useLocale();
  const isBug = item.type === "BUG";
  const itemTypeLabel = tApiError(`workflow.workItemType.${item.type}`);
  const lookup = useSpaceMembers(spaceId, organizationId);
  const { getVersion } = useVersions(spaceId, organizationId);
  const permissionState = useWorkItemPermissions({
    item,
    organizationId,
    spaceId,
    tApiError,
  });
  const detail = permissionState.detail;
  const workflowVersionIds = useMemo(
    () =>
      [item.workflowVersionId, detail?.workflowVersionId].filter(
        (id): id is string => Boolean(id),
      ),
    [detail?.workflowVersionId, item.workflowVersionId],
  );
  const workflowStateLookup = useWorkflowStateLookup(
    workflowVersionIds,
    spaceId,
    organizationId,
  );
  const priority = detail?.priority ?? item.priority;
  const statusCategory = detail?.statusCategory ?? item.statusCategory;
  const detailWorkflowState = detail
    ? workflowStateLookup.getState(
        detail.workflowVersionId,
        detail.currentStateId,
      )
    : undefined;
  const itemWorkflowState = workflowStateLookup.getState(
    item.workflowVersionId,
    item.currentStateId,
  );
  const statusLabel = detailWorkflowState
    ? translateWorkflowStateName(tApiError, detailWorkflowState)
    : detail
      ? item.statusLabel
      : itemWorkflowState
        ? translateWorkflowStateName(tApiError, itemWorkflowState)
        : item.statusLabel;
  const versionName = detail?.versionId
    ? (getVersion(detail.versionId)?.name ??
      missingLookupLabel(detail.versionId))
    : item.versionName;
  const dueDate = detail?.dueDate
    ? formatDateTime(detail.dueDate, locale)
    : item.dueDate;
  const isBlocked = detail
    ? statusCategory === "WAITING" || Boolean(detail.blockedAt)
    : item.isBlocked;
  const blockedReason = detail?.blockedReason ?? item.blockedReason;
  const detailRequestKey = getWorkItemSubresourceRequestKey({
    item,
    organizationId,
    spaceId,
  });
  const [timelineRefreshVersion, setTimelineRefreshVersion] = useState(0);
  const [nestedIntakeItemId, setNestedIntakeItemId] = useState<string | null>(
    null,
  );
  const [nestedTask, setNestedTask] = useState<WorkItemViewModel | null>(null);
  const [nestedTaskOpen, setNestedTaskOpen] = useState(false);
  const latestDetailRequestKeyRef = useRef(detailRequestKey);
  const latestOpenRef = useRef(open);
  latestDetailRequestKeyRef.current = detailRequestKey;
  latestOpenRef.current = open;
  const refreshTimeline = useCallback(() => {
    setTimelineRefreshVersion((version) => version + 1);
  }, []);
  useEffect(() => {
    setNestedIntakeItemId(null);
    setNestedTask(null);
    setNestedTaskOpen(false);
  }, [detailRequestKey, open]);
  const openNestedIntakeItem = useCallback((intakeItemId: string) => {
    if (!latestOpenRef.current) {
      return;
    }
    setNestedIntakeItemId(intakeItemId);
  }, []);
  const closeNestedIntakeItem = useCallback((open: boolean) => {
    if (!open) {
      setNestedIntakeItemId(null);
    }
  }, []);
  const openNestedTask = useCallback(
    async (workItemId: string) => {
      if (!spaceId) {
        return;
      }

      const requestKey = detailRequestKey;
      try {
        const workItem = await getWorkItem({
          organizationId,
          spaceId,
          workItemId,
        });
        if (
          latestDetailRequestKeyRef.current !== requestKey ||
          !latestOpenRef.current
        ) {
          return;
        }
        setNestedTask(
          toWorkItemListViewModel(workItem, {
            locale,
            lookups: {
              getMember: lookup.getMember,
              getVersion,
              getWorkflowState: workflowStateLookup.getState,
            },
            statusLabel: (category) =>
              tApiError(`workItems.statusCategory.${category}`),
            workflowStateLabel: (state) =>
              translateWorkflowStateName(tApiError, state),
          }),
        );
        setNestedTaskOpen(true);
      } catch {
        if (
          latestDetailRequestKeyRef.current !== requestKey ||
          !latestOpenRef.current
        ) {
          return;
        }
        setNestedTask(null);
        setNestedTaskOpen(false);
      }
    },
    [
      detailRequestKey,
      getVersion,
      locale,
      lookup.getMember,
      organizationId,
      spaceId,
      tApiError,
      workflowStateLookup.getState,
    ],
  );
  const openNestedWorkItem = useCallback(
    (workItem: WorkItem) => {
      if (!latestOpenRef.current) {
        return;
      }
      setNestedTask(
        toWorkItemListViewModel(workItem, {
          locale,
          lookups: {
            getMember: lookup.getMember,
            getVersion,
            getWorkflowState: workflowStateLookup.getState,
          },
          statusLabel: (category) =>
            tApiError(`workItems.statusCategory.${category}`),
          workflowStateLabel: (state) =>
            translateWorkflowStateName(tApiError, state),
        }),
      );
      setNestedTaskOpen(true);
    },
    [
      getVersion,
      locale,
      lookup.getMember,
      tApiError,
      workflowStateLookup.getState,
    ],
  );
  const closeNestedTask = useCallback((open: boolean) => {
    setNestedTaskOpen(open);
    if (!open) {
      setNestedTask(null);
    }
  }, []);
  const countRequestKey = detailRequestKey;
  const latestCountRequestKeyRef = useRef(countRequestKey);
  const countRequestSeqRef = useRef(0);
  const countRevisionRef = useRef({
    attachments: 0,
    comments: 0,
    requestKey: countRequestKey,
  });
  if (countRevisionRef.current.requestKey !== countRequestKey) {
    countRevisionRef.current = {
      attachments: 0,
      comments: 0,
      requestKey: countRequestKey,
    };
  }
  const [countState, setCountState] = useState(() => ({
    attachments: null as number | null,
    comments: null as number | null,
    requestKey: countRequestKey,
  }));
  latestCountRequestKeyRef.current = countRequestKey;
  const counts =
    countState.requestKey === countRequestKey
      ? countState
      : {
          attachments: null,
          comments: null,
          requestKey: countRequestKey,
        };
  const setCommentsCount = useCallback(
    (count: number) => {
      if (countRevisionRef.current.requestKey !== countRequestKey) {
        return;
      }
      countRevisionRef.current.comments += 1;
      setCountState((current) =>
        current.requestKey === countRequestKey
          ? { ...current, comments: count }
          : current,
      );
    },
    [countRequestKey],
  );
  const incrementCommentsCount = useCallback(() => {
    if (countRevisionRef.current.requestKey !== countRequestKey) {
      return;
    }
    countRevisionRef.current.comments += 1;
    setCountState((current) =>
      current.requestKey === countRequestKey
        ? { ...current, comments: (current.comments ?? 0) + 1 }
        : current,
    );
  }, [countRequestKey]);
  const setAttachmentsCount = useCallback(
    (count: number) => {
      if (countRevisionRef.current.requestKey !== countRequestKey) {
        return;
      }
      countRevisionRef.current.attachments += 1;
      setCountState((current) =>
        current.requestKey === countRequestKey
          ? { ...current, attachments: count }
          : current,
      );
    },
    [countRequestKey],
  );
  const fetchSubresourceCounts = useCallback(async (options?: RefreshModeOptions) => {
    const refreshMode = resolveRefreshMode(options, "initial");
    const nextRequestKey = countRequestKey;
    countRequestSeqRef.current += 1;
    const requestSeq = countRequestSeqRef.current;
    const commentsRevision = countRevisionRef.current.comments;
    const attachmentsRevision = countRevisionRef.current.attachments;

    if (!spaceId) {
      setCountState({
        attachments: null,
        comments: null,
        requestKey: nextRequestKey,
      });
      return;
    }

    if (shouldShowBlockingRefreshState(refreshMode)) {
      setCountState({
        attachments: null,
        comments: null,
        requestKey: nextRequestKey,
      });
    }

    const [commentsResult, attachmentsResult] = await Promise.allSettled([
      listComments({
        organizationId,
        page: 1,
        pageSize: 1,
        spaceId,
        targetId: item.id,
        targetType: "WORK_ITEM",
      }),
      listAttachments({
        organizationId,
        page: 1,
        pageSize: 1,
        spaceId,
        targetId: item.id,
        targetType: "WORK_ITEM",
      }),
    ]);

    if (
      requestSeq !== countRequestSeqRef.current ||
      latestCountRequestKeyRef.current !== nextRequestKey
    ) {
      return;
    }

    setCountState((current) => {
      if (current.requestKey !== nextRequestKey) {
        return current;
      }

      const revision = countRevisionRef.current;
      return {
        attachments:
          attachmentsResult.status === "fulfilled" &&
          revision.requestKey === nextRequestKey &&
          revision.attachments === attachmentsRevision
            ? attachmentsResult.value.total
            : current.attachments,
        comments:
          commentsResult.status === "fulfilled" &&
          revision.requestKey === nextRequestKey &&
          revision.comments === commentsRevision
            ? commentsResult.value.total
            : current.comments,
        requestKey: nextRequestKey,
      };
    });
  }, [countRequestKey, item.id, organizationId, spaceId]);

  useEffect(() => {
    void fetchSubresourceCounts({ mode: "initial" });
  }, [fetchSubresourceCounts]);

  useRealtimeInvalidation(WORK_ITEM_DETAIL_REALTIME_KEYS, (context) => {
    if (
      !realtimeContextIncludesTarget(context, {
        id: item.id,
        type: "WORK_ITEM",
      })
    ) {
      return;
    }

    const keys = new Set(context.keys);
    const shouldRefreshDetail =
      (isBug && keys.has("bug-list")) ||
      (!isBug && keys.has("work-item-list"));

    if (shouldRefreshDetail) {
      void permissionState.fetchPermissions({ mode: "realtime" });
    }
    if (
      keys.has("comments") ||
      keys.has("attachments") ||
      keys.has("timeline")
    ) {
      void fetchSubresourceCounts({ mode: "realtime" });
    }
    if (keys.has("timeline")) {
      refreshTimeline();
    }
  });

  return (
    <>
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
            <span>{itemTypeLabel}</span>
            <ChevronRight className="h-3 w-3" />
            <span className="truncate">{versionName}</span>
          </div>
          <SheetTitle className="mt-1 text-base leading-snug">
            {detail?.title ?? item.title}
          </SheetTitle>
          {detail && spaceId ? (
            <ObjectTagAssignmentField
              className="mt-2 w-full"
              canEdit={permissionState.permissions?.canEdit === true}
              onTagsChange={() => {
                void permissionState.fetchPermissions();
                onChanged?.();
              }}
              organizationId={organizationId}
              spaceId={spaceId}
              tags={detail.tags}
              targetId={detail.id}
              targetType="WORK_ITEM"
              testId="task-detail-tags"
            />
          ) : null}
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
          actionFocusRequest={actionFocusRequest}
          preferredActionId={preferredActionId}
          spaceId={spaceId}
          organizationId={organizationId}
          permissionState={permissionState}
          lookup={lookup}
          t={t}
          tApiError={tApiError}
          onChanged={onChanged}
          onTimelineRefresh={refreshTimeline}
        />

        {isBlocked && blockedReason && (
          <div className="border-b border-border bg-warning/10 px-5 py-2.5">
            <div className="flex items-start gap-2">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
              <div className="text-xs">
                <span className="font-medium text-warning">
                  {t("blocked.label")}
                </span>
                <span className="ml-2 text-foreground/80">
                  {translateExceptionReason(tApiError, blockedReason)}
                </span>
              </div>
            </div>
          </div>
        )}

        <Tabs
          defaultValue="detail"
          className="flex flex-1 flex-col overflow-hidden"
        >
          <TabsList className="w-full overflow-x-auto px-5">
            <TabsTrigger
              value="detail"
              className="shrink-0"
              data-testid="task-detail-tab"
            >
              {t("tabs.detail")}
            </TabsTrigger>
            <TabsTrigger
              value="comments"
              className="shrink-0 gap-1.5"
              data-testid="task-comments-tab"
            >
              <MessageSquare className="h-3 w-3" />
              {t("tabs.comments")}
              <TabCount count={counts.comments} />
            </TabsTrigger>
            <TabsTrigger
              value="attachments"
              className="shrink-0 gap-1.5"
              data-testid="task-attachments-tab"
            >
              <Paperclip className="h-3 w-3" />
              {t("tabs.attachments")}
              <TabCount count={counts.attachments} />
            </TabsTrigger>
            <TabsTrigger
              value="timeline"
              className="shrink-0 gap-1.5"
              data-testid="task-timeline-tab"
            >
              <Clock className="h-3 w-3" />
              {t("tabs.timeline")}
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
              canEdit={permissionState.permissions?.canEdit === true}
              organizationId={organizationId}
              spaceId={spaceId}
              t={t}
              tRoot={tApiError}
              versionName={versionName}
              onOpenIntakeItem={openNestedIntakeItem}
              onOpenRelatedTask={openNestedTask}
              onSaved={async () => {
                await permissionState.fetchPermissions();
                onChanged?.();
              }}
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
              onCountChange={setCommentsCount}
              onChanged={() => {
                incrementCommentsCount();
                refreshTimeline();
                onChanged?.();
              }}
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
              onCountChange={setAttachmentsCount}
              onTimelineRefresh={refreshTimeline}
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
              refreshVersion={timelineRefreshVersion}
            />
          </TabsContent>
        </Tabs>
      </SheetContent>
      <IntakeDetailSheet
        canComment={false}
        intakeItemId={nestedIntakeItemId ?? undefined}
        onOpenChange={closeNestedIntakeItem}
        onOpenWorkItem={openNestedWorkItem}
        open={Boolean(nestedIntakeItemId)}
        organizationId={organizationId}
        spaceId={spaceId}
        testId="nested-intake-detail-sheet"
      />
      <TaskDetailSheet
        item={nestedTask}
        open={nestedTaskOpen}
        onOpenChange={closeNestedTask}
        organizationId={organizationId}
        spaceId={spaceId}
        onChanged={onChanged}
      />
    </>
  );
}

function TabCount({ count }: { count: number | null }) {
  if (count === null) {
    return null;
  }

  return (
    <span
      aria-label={String(count)}
      className="ml-0.5 min-w-4 rounded-full bg-muted px-1.5 text-center text-[10px] font-medium leading-4 text-muted-foreground tabular-nums"
    >
      {count}
    </span>
  );
}

type WorkItemPermissionState = {
  detail: SheetDetail | null;
  error: string | null;
  fetchPermissions: (options?: RefreshModeOptions) => Promise<void>;
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

  const fetchPermissions = useCallback(async (options?: RefreshModeOptions) => {
    const refreshMode = resolveRefreshMode(options, "initial");
    requestSeqRef.current += 1;
    const requestSeq = requestSeqRef.current;
    const nextRequestKey = requestKey;
    const requestItem = { id: item.id, type: item.type };

    setState((current) => {
      const sameRequestKey = current.requestKey === nextRequestKey;

      return {
        detail: sameRequestKey ? current.detail : null,
        error: shouldSurfaceRefreshError(refreshMode) ? null : current.error,
        loading: shouldShowBlockingRefreshState(refreshMode),
        permissions: sameRequestKey ? current.permissions : null,
        requestKey: nextRequestKey,
      };
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
      setState((current) => ({
        detail: shouldSurfaceRefreshError(refreshMode) ? null : current.detail,
        error: shouldSurfaceRefreshError(refreshMode)
          ? tApiError(key)
          : current.error,
        loading: false,
        permissions: shouldSurfaceRefreshError(refreshMode)
          ? null
          : current.permissions,
        requestKey: nextRequestKey,
      }));
    }
  }, [item.id, item.type, organizationId, requestKey, spaceId, tApiError]);

  useEffect(() => {
    void fetchPermissions({ mode: "initial" });
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
  actionFocusRequest,
  preferredActionId,
  spaceId,
  organizationId,
  permissionState,
  lookup,
  t,
  tApiError,
  onChanged,
  onTimelineRefresh,
}: {
  item: WorkItemViewModel;
  actionFocusRequest?: number;
  preferredActionId?: string;
  spaceId?: string;
  organizationId?: string;
  permissionState: WorkItemPermissionState;
  lookup: ReturnType<typeof useSpaceMembers>;
  t: ReturnType<typeof useTranslations<"taskDetail">>;
  tApiError: ReturnType<typeof useTranslations>;
  onChanged?: () => void;
  onTimelineRefresh?: () => void;
}) {
  const [executingId, setExecutingId] = useState<string | null>(null);
  const [executeError, setExecuteError] = useState<string | null>(null);
  const [selectedAction, setSelectedAction] =
    useState<WorkflowActionSummary | null>(null);
  const [commentDraft, setCommentDraft] = useState("");
  const [formDraft, setFormDraft] = useState<Record<string, string>>({});
  const [formErrors, setFormErrors] = useState<ActionFormErrors>(
    createEmptyActionFormErrors,
  );
  const actionRegionRef = useRef<HTMLDivElement | null>(null);
  const preparedActionRequestRef = useRef<string | null>(null);

  const resetActionForm = useCallback(() => {
    setSelectedAction(null);
    setCommentDraft("");
    setFormDraft({});
    setFormErrors(createEmptyActionFormErrors());
  }, []);

  const prepareActionForConfirmation = useCallback(
    (action: WorkflowActionSummary) => {
      setExecuteError(null);
      setFormErrors(createEmptyActionFormErrors());
      setSelectedAction(action);
      setCommentDraft("");
      setFormDraft(
        Object.fromEntries(action.formFields.map((field) => [field.key, ""])),
      );
    },
    [],
  );

  const beginAction = (action: WorkflowActionSummary) => {
    setExecuteError(null);
    setFormErrors(createEmptyActionFormErrors());

    if (!action.requiresComment && action.formFields.length === 0) {
      void handleExecute(action, { formValues: {} });
      return;
    }

    prepareActionForConfirmation(action);
  };

  const handleExecute = async (
    action: WorkflowActionSummary,
    input: { comment?: string; formValues: Record<string, unknown> },
  ) => {
    if (!spaceId) return;

    const nextFormErrors = collectActionFormErrors(action, input);
    if (hasActionFormErrors(nextFormErrors)) {
      setFormErrors(nextFormErrors);
      setExecuteError(tApiError("errors.api.WORKFLOW_ACTION_FORM_INVALID"));
      return;
    }

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
      onTimelineRefresh?.();
      onChanged?.();
    } catch (err) {
      const key = getApiErrorMessageKey(err);
      const fieldKey = getApiErrorField(err);
      if (fieldKey) {
        setFormErrors(markActionFormFieldError(action, fieldKey));
      }
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

  useEffect(() => {
    if (!actionFocusRequest || actionFocusRequest <= 0) {
      return;
    }

    const schedule =
      typeof window.requestAnimationFrame === "function"
        ? window.requestAnimationFrame
        : (callback: FrameRequestCallback) =>
            window.setTimeout(() => callback(performance.now()), 0);

    schedule(() => {
      const node = actionRegionRef.current;
      if (!node) {
        return;
      }

      node.scrollIntoView?.({ block: "nearest" });
      node.focus({ preventScroll: true });
    });
  }, [actionFocusRequest]);

  useEffect(() => {
    if (!actionFocusRequest || actionFocusRequest <= 0 || !preferredActionId) {
      preparedActionRequestRef.current = null;
      return;
    }

    const requestKey = `${item.id}:${actionFocusRequest}:${preferredActionId}`;
    if (preparedActionRequestRef.current === requestKey) {
      return;
    }

    const action = actions.find(
      (candidate) => candidate.id === preferredActionId,
    );
    if (!action) {
      return;
    }

    preparedActionRequestRef.current = requestKey;
    prepareActionForConfirmation(action);
  }, [
    actionFocusRequest,
    actions,
    item.id,
    preferredActionId,
    prepareActionForConfirmation,
  ]);

  return (
    <div
      ref={actionRegionRef}
      role="region"
      aria-label={t("actions.label")}
      tabIndex={-1}
      data-testid="task-actions-region"
      className="flex flex-col gap-1.5 border-b border-border bg-muted/30 px-5 py-2.5 outline-none focus:ring-2 focus:ring-ring"
    >
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
                  translateWorkflowActionName(tApiError, action)
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
          formErrors={formErrors}
          formDraft={formDraft}
          lookup={lookup}
          onCancel={resetActionForm}
          onCommentChange={(value) => {
            setCommentDraft(value);
            setFormErrors(clearActionFormCommentError);
          }}
          onFieldChange={(key, value) => {
            setFormDraft((current) => ({ ...current, [key]: value }));
            setFormErrors((current) => clearActionFormFieldError(current, key));
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
  formErrors,
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
  formErrors: ActionFormErrors;
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
            errorMessage={
              formErrors.fields[field.key] ? t("actions.fieldError") : undefined
            }
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
              aria-describedby={
                formErrors.comment
                  ? `task-action-comment-${action.id}-error`
                  : undefined
              }
              aria-invalid={formErrors.comment ? true : undefined}
              data-testid="task-action-comment"
              value={commentDraft}
              maxLength={4000}
              rows={3}
              placeholder={t("comments.placeholder")}
              disabled={executing}
              onChange={(event) => onCommentChange(event.target.value)}
            />
            {formErrors.comment ? (
              <p
                id={`task-action-comment-${action.id}-error`}
                className="text-[11px] text-destructive"
              >
                {t("actions.commentError")}
              </p>
            ) : null}
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
            translateWorkflowActionName(tRoot, action)
          )}
        </Button>
      </div>
    </div>
  );
}

function ActionFormFieldControl({
  errorMessage,
  field,
  lookup,
  onChange,
  value,
}: {
  errorMessage?: string;
  field: ActionFormFieldSummary;
  lookup: ReturnType<typeof useSpaceMembers>;
  onChange: (value: string) => void;
  value: string;
}) {
  const id = `task-action-field-${field.id}`;
  const tRoot = useTranslations();
  const fieldLabel = translateWorkflowFieldLabel(tRoot, field);
  const label = field.required ? `${fieldLabel} *` : fieldLabel;
  const errorId = `${id}-error`;
  const error = errorMessage ? (
    <p id={errorId} className="text-[11px] text-destructive">
      {errorMessage}
    </p>
  ) : null;

  if (field.fieldType === "TEXTAREA") {
    return (
      <div className="flex flex-col gap-1.5 sm:col-span-2">
        <Label htmlFor={id}>{label}</Label>
        <Textarea
          id={id}
          aria-describedby={errorMessage ? errorId : undefined}
          aria-invalid={errorMessage ? true : undefined}
          data-testid="task-action-field"
          data-field-key={field.key}
          value={value}
          rows={3}
          className={cn(
            errorMessage && "border-destructive focus-visible:ring-destructive",
          )}
          onChange={(event) => onChange(event.target.value)}
        />
        {error}
      </div>
    );
  }

  if (field.fieldType === "SELECT") {
    return (
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={id}>{label}</Label>
        <SelectMenu
          id={id}
          aria-describedby={errorMessage ? errorId : undefined}
          aria-invalid={errorMessage ? true : undefined}
          data-testid="task-action-field"
          data-field-key={field.key}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className={cn(
            "h-8 w-full rounded-md border border-input bg-background px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            errorMessage && "border-destructive focus-visible:ring-destructive",
          )}
        >
          <option value="" />
          {(field.options ?? []).map((option) => (
            <option key={option} value={option}>
              {translateWorkflowSelectOption(tRoot, field, option)}
            </option>
          ))}
        </SelectMenu>
        {error}
      </div>
    );
  }

  if (field.fieldType === "USER") {
    const hasMembers = lookup.members.length > 0;

    return (
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={id}>{label}</Label>
        <SelectMenu
          id={id}
          aria-describedby={errorMessage ? errorId : undefined}
          aria-invalid={errorMessage ? true : undefined}
          data-testid="task-action-field"
          data-field-key={field.key}
          disabled={!hasMembers}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className={cn(
            "h-8 w-full rounded-md border border-input bg-background px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            errorMessage && "border-destructive focus-visible:ring-destructive",
          )}
        >
          <option value="">{hasMembers ? "" : "-"}</option>
          {lookup.members.map((member) => (
            <option key={member.userId} value={member.userId}>
              {member.user.name || member.user.username}
            </option>
          ))}
        </SelectMenu>
        {error}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        aria-describedby={errorMessage ? errorId : undefined}
        aria-invalid={errorMessage ? true : undefined}
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
        className={cn(
          errorMessage && "border-destructive focus-visible:ring-destructive",
        )}
        onChange={(event) => onChange(event.target.value)}
      />
      {error}
    </div>
  );
}

type ActionFormErrors = {
  comment: boolean;
  fields: Record<string, boolean>;
};

function createEmptyActionFormErrors(): ActionFormErrors {
  return {
    comment: false,
    fields: {},
  };
}

function hasActionFormErrors(errors: ActionFormErrors): boolean {
  return errors.comment || Object.keys(errors.fields).length > 0;
}

function collectActionFormErrors(
  action: WorkflowActionSummary,
  input: { comment?: string; formValues: Record<string, unknown> },
): ActionFormErrors {
  const errors = createEmptyActionFormErrors();

  if (action.requiresComment && isBlankActionFormValue(input.comment)) {
    errors.comment = true;
  }

  action.formFields.forEach((field) => {
    if (field.required && isBlankActionFormValue(input.formValues[field.key])) {
      errors.fields[field.key] = true;
    }
  });

  return errors;
}

function markActionFormFieldError(
  action: WorkflowActionSummary,
  fieldKey: string,
): ActionFormErrors {
  const errors = createEmptyActionFormErrors();

  if (fieldKey === "comment") {
    errors.comment = true;
    return errors;
  }

  if (action.formFields.some((field) => field.key === fieldKey)) {
    errors.fields[fieldKey] = true;
  }

  return errors;
}

function clearActionFormCommentError(
  errors: ActionFormErrors,
): ActionFormErrors {
  if (!errors.comment) return errors;

  return {
    ...errors,
    comment: false,
  };
}

function clearActionFormFieldError(
  errors: ActionFormErrors,
  fieldKey: string,
): ActionFormErrors {
  if (!errors.fields[fieldKey]) return errors;

  const { [fieldKey]: _removed, ...fields } = errors.fields;

  return {
    ...errors,
    fields,
  };
}

function isBlankActionFormValue(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    (typeof value === "string" && value.trim().length === 0)
  );
}

function getApiErrorField(error: unknown): string | undefined {
  if (!(error instanceof ApiClientError)) {
    return undefined;
  }

  const details = error.error.details;

  if (
    details &&
    typeof details === "object" &&
    "field" in details &&
    typeof details.field === "string"
  ) {
    return details.field;
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// Detail tab
// ---------------------------------------------------------------------------

function DetailTab({
  canEdit,
  item,
  detail,
  lookup,
  onOpenIntakeItem,
  onOpenRelatedTask,
  onSaved,
  organizationId,
  spaceId,
  t,
  tRoot,
  versionName,
}: {
  canEdit: boolean;
  item: WorkItemViewModel;
  detail: SheetDetail | null;
  lookup: ReturnType<typeof useSpaceMembers>;
  onOpenIntakeItem: (intakeItemId: string) => void;
  onOpenRelatedTask: (workItemId: string) => void;
  onSaved: () => Promise<void>;
  organizationId?: string;
  spaceId?: string;
  t: ReturnType<typeof useTranslations<"taskDetail">>;
  tRoot: ReturnType<typeof useTranslations>;
  versionName?: string;
}) {
  const locale = useLocale();
  const assigneeId = detail?.assigneeId || undefined;
  const assignee = displayUser(assigneeId, lookup.getMember);
  const reporter = displayUser(detail?.reporterId, lookup.getMember);
  const updatedAt = detail?.lastActionAt ?? detail?.lastStatusChangedAt;
  const bugDetail = isBugSheetDetail(detail) ? detail.bugDetail : null;
  const { versions } = useVersions(spaceId, organizationId);
  const [editing, setEditing] = useState(false);
  const [requirements, setRequirements] = useState<Requirement[]>([]);
  const [intakeItems, setIntakeItems] = useState<IntakeItem[]>([]);
  const [relatedTasks, setRelatedTasks] = useState<WorkItem[]>([]);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<Priority>("MEDIUM");
  const [severity, setSeverity] = useState<BugSeverity>("MAJOR");
  const [editAssigneeId, setEditAssigneeId] = useState("");
  const [editVersionId, setEditVersionId] = useState("");
  const [editRequirementId, setEditRequirementId] = useState("");
  const [editIntakeItemId, setEditIntakeItemId] = useState("");
  const [editRelatedTaskId, setEditRelatedTaskId] = useState("");
  const [stepsToReproduce, setStepsToReproduce] = useState("");
  const [expectedResult, setExpectedResult] = useState("");
  const [actualResult, setActualResult] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [titleError, setTitleError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [pendingCascadeConfirm, setPendingCascadeConfirm] =
    useState<PendingTraceCascadeConfirm | null>(null);
  const editTargetKey = `${item.id}:${detail?.id ?? ""}`;
  const previousEditTargetKeyRef = useRef(editTargetKey);

  const resetEditDraft = useCallback(() => {
    setTitle(detail?.title ?? item.title);
    setDescription(detail?.description ?? "");
    setPriority(detail?.priority ?? item.priority);
    setSeverity(bugDetail?.severity ?? "MAJOR");
    setEditAssigneeId(detail?.assigneeId ?? "");
    setEditVersionId(detail?.versionId ?? "");
    setEditRequirementId(detail?.requirementId ?? "");
    setEditIntakeItemId(detail?.intakeItemId ?? "");
    setEditRelatedTaskId(bugDetail?.relatedTaskId ?? "");
    setStepsToReproduce(bugDetail?.stepsToReproduce ?? "");
    setExpectedResult(bugDetail?.expectedResult ?? "");
    setActualResult(bugDetail?.actualResult ?? "");
    setDueDate(toDateInputValue(detail?.dueDate));
    setTitleError(false);
    setSaveError(null);
    setPendingCascadeConfirm(null);
  }, [
    bugDetail?.actualResult,
    bugDetail?.expectedResult,
    bugDetail?.relatedTaskId,
    bugDetail?.severity,
    bugDetail?.stepsToReproduce,
    detail?.assigneeId,
    detail?.description,
    detail?.dueDate,
    detail?.intakeItemId,
    detail?.priority,
    detail?.requirementId,
    detail?.title,
    detail?.versionId,
    item.priority,
    item.title,
  ]);

  useEffect(() => {
    if (previousEditTargetKeyRef.current === editTargetKey) {
      return;
    }

    previousEditTargetKeyRef.current = editTargetKey;
    setEditing(false);
    resetEditDraft();
  }, [editTargetKey, resetEditDraft]);

  useEffect(() => {
    if (!editing) {
      resetEditDraft();
    }
  }, [editing, resetEditDraft]);

  const startEdit = () => {
    resetEditDraft();
    setEditing(true);
  };

  const cancelEdit = () => {
    resetEditDraft();
    setEditing(false);
  };

  useEffect(() => {
    if (!editing || !spaceId) {
      return;
    }

    let cancelled = false;

    void Promise.all([
      listRequirements({
        organizationId,
        page: 1,
        pageSize: 100,
        spaceId,
      }),
      listIntakeItems({
        organizationId,
        page: 1,
        pageSize: 100,
        spaceId,
      }),
      isBugSheetDetail(detail)
        ? listWorkItems({
            organizationId,
            page: 1,
            pageSize: 100,
            spaceId,
          })
        : Promise.resolve({ items: [] as WorkItem[] }),
    ])
      .then(([requirementResult, intakeResult, taskResult]) => {
        if (!cancelled) {
          setRequirements(requirementResult.items);
          setIntakeItems(intakeResult.items);
          setRelatedTasks(taskResult.items);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setRequirements([]);
          setIntakeItems([]);
          setRelatedTasks([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [detail, editing, organizationId, spaceId]);

  const filteredRequirements = useMemo(
    () =>
      filterTraceOptionsByVersion(
        requirements,
        editVersionId,
        editRequirementId,
      ),
    [editRequirementId, editVersionId, requirements],
  );
  const filteredIntakeItems = useMemo(
    () =>
      filterTraceOptionsByVersion(intakeItems, editVersionId, editIntakeItemId),
    [editIntakeItemId, editVersionId, intakeItems],
  );
  const filteredRelatedTasks = useMemo(
    () =>
      filterTraceOptionsByVersion(
        relatedTasks,
        editVersionId,
        editRelatedTaskId,
      ),
    [editRelatedTaskId, editVersionId, relatedTasks],
  );

  function handleEditVersionChange(nextVersionId: string) {
    setEditVersionId(nextVersionId);
    setEditRequirementId((current) =>
      clearIncompatibleTraceSelection(requirements, current, nextVersionId),
    );
    setEditIntakeItemId((current) =>
      clearIncompatibleTraceSelection(intakeItems, current, nextVersionId),
    );
    setEditRelatedTaskId((current) =>
      clearIncompatibleTraceSelection(relatedTasks, current, nextVersionId),
    );
  }

  function handleEditRequirementChange(nextRequirementId: string) {
    setEditRequirementId(nextRequirementId);

    const nextRequirement = requirements.find(
      (requirement) => requirement.id === nextRequirementId,
    );
    setEditVersionId(
      inheritVersionFromTraceOption(nextRequirement, editVersionId),
    );
  }

  function handleEditIntakeItemChange(nextIntakeItemId: string) {
    setEditIntakeItemId(nextIntakeItemId);

    const nextIntakeItem = intakeItems.find(
      (intakeItem) => intakeItem.id === nextIntakeItemId,
    );
    const nextRequirement = requirements.find(
      (requirement) => requirement.id === nextIntakeItem?.requirementId,
    );
    setEditVersionId(
      inheritVersionFromTraceOption(
        nextIntakeItem,
        inheritVersionFromTraceOption(nextRequirement, editVersionId),
      ),
    );
    if (nextIntakeItem?.requirementId) {
      setEditRequirementId(nextIntakeItem.requirementId);
    }
  }

  function handleEditRelatedTaskChange(nextRelatedTaskId: string) {
    setEditRelatedTaskId(nextRelatedTaskId);

    const nextRelatedTask = relatedTasks.find(
      (relatedTask) => relatedTask.id === nextRelatedTaskId,
    );
    const nextRequirement = requirements.find(
      (requirement) => requirement.id === nextRelatedTask?.requirementId,
    );
    setEditVersionId(
      inheritVersionFromTraceOption(
        nextRelatedTask,
        inheritVersionFromTraceOption(nextRequirement, editVersionId),
      ),
    );
    if (nextRelatedTask?.requirementId) {
      setEditRequirementId(nextRelatedTask.requirementId);
    }
  }

  const submitEdit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!detail || !spaceId || !canEdit) {
      return;
    }

    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setTitleError(true);
      return;
    }

    setSaving(true);
    setSaveError(null);

    let pendingRequest: PendingTraceCascadeConfirm["request"] | null = null;
    let pendingTargetType: PendingTraceCascadeConfirm["targetType"] | null =
      null;

    try {
      const commonPatch = {
        assigneeId: editAssigneeId,
        description,
        dueDate: dueDate ? new Date(`${dueDate}T00:00:00`).toISOString() : "",
        priority,
        intakeItemId: editIntakeItemId,
        requirementId: editRequirementId,
        title: trimmedTitle,
        versionId: editVersionId,
      };

      if (isBugSheetDetail(detail)) {
        const bugUpdateRequest = toUpdateBugRequest({
          ...commonPatch,
          actualResult,
          expectedResult,
          relatedTaskId: editRelatedTaskId,
          severity,
          stepsToReproduce,
        });
        pendingRequest = bugUpdateRequest;
        pendingTargetType = "BUG";
        await updateBug(
          {
            bugId: detail.id,
            organizationId,
            spaceId,
          },
          bugUpdateRequest,
        );
      } else {
        const taskUpdateRequest = toUpdateTaskRequest(commonPatch);
        pendingRequest = taskUpdateRequest;
        pendingTargetType = "TASK";
        await updateWorkItem(
          {
            organizationId,
            spaceId,
            workItemId: detail.id,
          },
          taskUpdateRequest,
        );
      }
      await onSaved();
      setEditing(false);
    } catch (err) {
      if (
        pendingRequest &&
        pendingTargetType &&
        isTraceVersionCascadeRequiredError(err)
      ) {
        if (pendingTargetType === "TASK") {
          setPendingCascadeConfirm({
            request: pendingRequest as ReturnType<typeof toUpdateTaskRequest>,
            targetType: "TASK",
            message: traceVersionCascadeConfirmMessage(
              {
                body: tRoot("errors.api.TRACE_VERSION_CHANGE_REQUIRES_CASCADE"),
                labels: getTraceVersionCascadeConfirmLabels(tRoot),
                suffix: tRoot(
                  "errors.api.TRACE_VERSION_CHANGE_REQUIRES_CASCADE_CONFIRM_SUFFIX",
                ),
              },
              err,
            ),
          });
        } else {
          setPendingCascadeConfirm({
            request: pendingRequest as ReturnType<typeof toUpdateBugRequest>,
            targetType: "BUG",
            message: traceVersionCascadeConfirmMessage(
              {
                body: tRoot("errors.api.TRACE_VERSION_CHANGE_REQUIRES_CASCADE"),
                labels: getTraceVersionCascadeConfirmLabels(tRoot),
                suffix: tRoot(
                  "errors.api.TRACE_VERSION_CHANGE_REQUIRES_CASCADE_CONFIRM_SUFFIX",
                ),
              },
              err,
            ),
          });
        }
        return;
      }
      const key = getApiErrorMessageKey(err);
      setSaveError(tRoot(key));
    } finally {
      setSaving(false);
    }
  };

  const confirmCascadeVersionChange = async () => {
    if (!detail || !spaceId || !canEdit || !pendingCascadeConfirm) {
      return;
    }

    setSaving(true);
    setSaveError(null);

    try {
      if (pendingCascadeConfirm.targetType === "BUG") {
        if (!isBugSheetDetail(detail)) {
          return;
        }

        await updateBug(
          {
            bugId: detail.id,
            organizationId,
            spaceId,
          },
          {
            ...pendingCascadeConfirm.request,
            cascadeVersionChange: true,
          },
        );
      } else {
        await updateWorkItem(
          {
            organizationId,
            spaceId,
            workItemId: detail.id,
          },
          {
            ...pendingCascadeConfirm.request,
            cascadeVersionChange: true,
          },
        );
      }
      setPendingCascadeConfirm(null);
      await onSaved();
      setEditing(false);
    } catch (err) {
      setPendingCascadeConfirm(null);
      const key = getApiErrorMessageKey(err);
      setSaveError(tRoot(key));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      {canEdit && detail && (
        <div className="mb-4 flex justify-end">
          <Button
            type="button"
            size="sm"
            variant={editing ? "secondary" : "outline"}
            className="h-7 text-xs"
            data-testid="task-edit-button"
            onClick={editing ? cancelEdit : startEdit}
          >
            <Pencil className="h-3 w-3" />
            {editing ? t("edit.cancel") : t("edit.button")}
          </Button>
        </div>
      )}
      {editing && detail && (
        <form
          data-testid="task-edit-form"
          className="mb-5 rounded-md border border-border bg-muted/20 p-3"
          onSubmit={submitEdit}
          noValidate
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <Label htmlFor="task-edit-title">{t("edit.title")}</Label>
              <Input
                id="task-edit-title"
                data-testid="task-edit-title-input"
                value={title}
                maxLength={200}
                disabled={saving}
                aria-invalid={titleError}
                onChange={(event) => {
                  setTitle(event.target.value);
                  if (titleError) {
                    setTitleError(false);
                  }
                }}
              />
              {titleError && (
                <span className="text-[11px] text-destructive" role="alert">
                  {t("edit.titleError")}
                </span>
              )}
            </div>
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <Label htmlFor="task-edit-description">
                {t("description.title")}
              </Label>
              <Textarea
                id="task-edit-description"
                data-testid="task-edit-description-input"
                value={description}
                maxLength={8000}
                rows={3}
                disabled={saving}
                onChange={(event) => setDescription(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="task-edit-priority">{t("fields.priority")}</Label>
              <SelectMenu
                id="task-edit-priority"
                data-testid="task-edit-priority-select"
                value={priority}
                disabled={saving}
                onChange={(event) =>
                  setPriority(event.target.value as Priority)
                }
                className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {TASK_PRIORITIES.map((nextPriority) => (
                  <option key={nextPriority} value={nextPriority}>
                    {t(`priority.${nextPriority}`)}
                  </option>
                ))}
              </SelectMenu>
            </div>
            {isBugSheetDetail(detail) ? (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="task-edit-severity">
                  {tRoot("bugs.form.severity")}
                </Label>
                <SelectMenu
                  id="task-edit-severity"
                  data-testid="task-edit-severity-select"
                  value={severity}
                  disabled={saving}
                  onChange={(event) =>
                    setSeverity(event.target.value as BugSeverity)
                  }
                  className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {BUG_SEVERITIES.map((nextSeverity) => (
                    <option key={nextSeverity} value={nextSeverity}>
                      {tRoot(`bugs.severity.${nextSeverity}`)}
                    </option>
                  ))}
                </SelectMenu>
              </div>
            ) : null}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="task-edit-assignee">{t("fields.assignee")}</Label>
              <SelectMenu
                id="task-edit-assignee"
                data-testid="task-edit-assignee-select"
                value={editAssigneeId}
                disabled={saving}
                onChange={(event) => setEditAssigneeId(event.target.value)}
                className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="">{t("edit.unassigned")}</option>
                {lookup.members.map((member) => (
                  <option key={member.userId} value={member.userId}>
                    {member.user.name || member.user.username}
                  </option>
                ))}
              </SelectMenu>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="task-edit-version">{t("fields.version")}</Label>
              <SelectMenu
                id="task-edit-version"
                data-testid="task-edit-version-select"
                value={editVersionId}
                disabled={saving}
                onChange={(event) =>
                  handleEditVersionChange(event.target.value)
                }
                className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="">{t("edit.noVersion")}</option>
                {versions.map((version) => (
                  <option key={version.id} value={version.id}>
                    {version.name}
                  </option>
                ))}
              </SelectMenu>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="task-edit-requirement">
                {t("fields.requirement")}
              </Label>
              <SelectMenu
                id="task-edit-requirement"
                data-testid="task-edit-requirement-select"
                value={editRequirementId}
                disabled={saving}
                onChange={(event) =>
                  handleEditRequirementChange(event.target.value)
                }
                className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="">{t("edit.noRequirement")}</option>
                {filteredRequirements.map((requirement) => (
                  <option key={requirement.id} value={requirement.id}>
                    {requirement.title || requirement.id}
                  </option>
                ))}
              </SelectMenu>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="task-edit-intake">{t("fields.intake")}</Label>
              <SelectMenu
                id="task-edit-intake"
                data-testid="task-edit-intake-select"
                value={editIntakeItemId}
                disabled={saving}
                onChange={(event) =>
                  handleEditIntakeItemChange(event.target.value)
                }
                className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="">
                  {tRoot("workItems.trace.noIntakeItem")}
                </option>
                {filteredIntakeItems.map((intakeItem) => (
                  <option key={intakeItem.id} value={intakeItem.id}>
                    {intakeItem.title || intakeItem.id}
                  </option>
                ))}
              </SelectMenu>
            </div>
            {isBugSheetDetail(detail) ? (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="task-edit-related-task">
                  {tRoot("bugs.form.relatedTask")}
                </Label>
                <SelectMenu
                  id="task-edit-related-task"
                  data-testid="task-edit-related-task-select"
                  value={editRelatedTaskId}
                  disabled={saving}
                  onChange={(event) =>
                    handleEditRelatedTaskChange(event.target.value)
                  }
                  className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <option value="">{tRoot("bugs.form.noRelatedTask")}</option>
                  {filteredRelatedTasks.map((relatedTask) => (
                    <option key={relatedTask.id} value={relatedTask.id}>
                      {relatedTask.title || relatedTask.id}
                    </option>
                  ))}
                </SelectMenu>
              </div>
            ) : null}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="task-edit-due-date">{t("fields.due")}</Label>
              <Input
                id="task-edit-due-date"
                data-testid="task-edit-due-date-input"
                type="date"
                value={dueDate}
                disabled={saving}
                onChange={(event) => setDueDate(event.target.value)}
              />
            </div>
            {isBugSheetDetail(detail) ? (
              <>
                <BugEditTextArea
                  id="task-edit-steps"
                  label={tRoot("bugs.bugFields.stepsToReproduce")}
                  value={stepsToReproduce}
                  disabled={saving}
                  onChange={setStepsToReproduce}
                />
                <BugEditTextArea
                  id="task-edit-expected"
                  label={tRoot("bugs.bugFields.expectedResult")}
                  value={expectedResult}
                  disabled={saving}
                  onChange={setExpectedResult}
                />
                <BugEditTextArea
                  id="task-edit-actual"
                  label={tRoot("bugs.bugFields.actualResult")}
                  value={actualResult}
                  disabled={saving}
                  onChange={setActualResult}
                />
              </>
            ) : null}
          </div>
          {saveError && (
            <p className="mt-3 text-[11px] text-destructive" role="alert">
              {saveError}
            </p>
          )}
          <div className="mt-3 flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              disabled={saving}
              onClick={cancelEdit}
            >
              {t("edit.cancel")}
            </Button>
            <Button
              type="submit"
              size="sm"
              className="h-7 text-xs"
              data-testid="task-edit-submit"
              disabled={saving}
            >
              {saving ? (
                <>
                  <Loader2 className="h-3 w-3 animate-spin" />
                  {t("edit.saving")}
                </>
              ) : (
                t("edit.save")
              )}
            </Button>
          </div>
        </form>
      )}
      <TraceVersionCascadeConfirmDialog
        message={pendingCascadeConfirm?.message ?? ""}
        onCancel={() => setPendingCascadeConfirm(null)}
        onConfirm={() => void confirmCascadeVersionChange()}
        open={pendingCascadeConfirm !== null}
        submitting={saving}
      />
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
              ? formatDateTime(updatedAt, locale)
              : (item.updatedAgo ?? "—")
          }
        />
      </div>
      <TraceabilitySection
        detail={detail}
        onOpenIntakeItem={onOpenIntakeItem}
        onOpenRelatedTask={onOpenRelatedTask}
        organizationId={organizationId}
        spaceId={spaceId}
        t={t}
        tApiError={tRoot}
        versionName={versionName}
      />
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
                  ? formatDateTime(bugDetail.regressionAt, locale)
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

function BugEditTextArea({
  disabled,
  id,
  label,
  onChange,
  value,
}: {
  disabled: boolean;
  id: string;
  label: string;
  onChange: (value: string) => void;
  value: string;
}) {
  return (
    <div className="flex flex-col gap-1.5 sm:col-span-2">
      <Label htmlFor={id}>{label}</Label>
      <Textarea
        id={id}
        data-testid={`${id}-input`}
        value={value}
        maxLength={8000}
        rows={3}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
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
// Traceability
// ---------------------------------------------------------------------------

function TraceabilitySection({
  detail,
  onOpenIntakeItem,
  onOpenRelatedTask,
  spaceId,
  organizationId,
  t,
  tApiError,
  versionName,
}: {
  detail: SheetDetail | null;
  onOpenIntakeItem: (intakeItemId: string) => void;
  onOpenRelatedTask: (workItemId: string) => void;
  spaceId?: string;
  organizationId?: string;
  t: ReturnType<typeof useTranslations<"taskDetail">>;
  tApiError: ReturnType<typeof useTranslations>;
  versionName?: string;
}) {
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

  if (!detail) {
    return null;
  }

  const links: TraceabilityLink[] = [];
  if (detail.versionId && versionName) {
    links.push({
      kind: "text",
      icon: GitBranch,
      label: t("fields.version"),
      value: versionName,
    });
  }
  if (detail.requirementId) {
    links.push({
      href: `/requirements/${detail.requirementId}`,
      kind: "anchor",
      icon: Link2,
      label: t("fields.requirement"),
      result: requirementTitle,
    });
  }
  if (detail.intakeItemId) {
    links.push({
      kind: "button",
      icon: Link2,
      label: t("fields.intake"),
      onClick: () => onOpenIntakeItem(detail.intakeItemId ?? ""),
      result: intakeTitle,
      testId: "task-intake-link",
    });
  }
  if (isBugSheetDetail(detail) && detail.bugDetail.relatedTaskId) {
    links.push({
      kind: "button",
      icon: Link2,
      label: tApiError("bugs.form.relatedTask"),
      onClick: () => onOpenRelatedTask(detail.bugDetail.relatedTaskId ?? ""),
      result: relatedTaskTitle,
      testId: "task-related-task-link",
    });
  }

  return (
    <div data-testid="task-links-section" className="mt-6 space-y-3">
      <h3 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {t("tabs.links")}
      </h3>
      {links.length === 0 ? (
        <p className="text-sm leading-relaxed text-muted-foreground">
          {t("links.emptyDescription")}
        </p>
      ) : (
        <div data-testid="task-links-list" className="grid gap-y-3 text-[13px]">
          {links.map((link, idx) => (
            <div key={`${link.label}-${idx}`} data-testid="task-links-item">
              <TraceabilityRow link={link} t={t} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

type TraceabilityLink =
  | {
      icon: typeof GitBranch;
      kind: "text";
      label: string;
      value: string;
    }
  | {
      href: string;
      icon: typeof GitBranch;
      kind: "anchor";
      label: string;
      result: ReturnType<typeof useRelationTitle>;
    }
  | {
      icon: typeof GitBranch;
      kind: "button";
      label: string;
      onClick: () => void;
      result: ReturnType<typeof useRelationTitle>;
      testId: string;
    };

function TraceabilityRow({
  link,
  t,
}: {
  link: TraceabilityLink;
  t: ReturnType<typeof useTranslations<"taskDetail">>;
}) {
  const Icon = link.icon;

  if (link.kind === "text") {
    return <FieldRow icon={Icon} label={link.label} value={link.value} />;
  }

  const value = relationTitleValue(link.result, t);
  const disabled =
    link.result.loading || Boolean(link.result.error) || !link.result.title;

  return (
    <div className="flex items-center gap-2">
      <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
        {link.label}
      </span>
      {disabled ? (
        <span className="ml-auto truncate font-medium text-muted-foreground">
          {value}
        </span>
      ) : link.kind === "anchor" ? (
        <Link
          className="ml-auto cursor-pointer truncate font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          data-testid="task-requirement-link"
          href={link.href}
        >
          {value}
        </Link>
      ) : (
        <button
          className="ml-auto max-w-[60%] cursor-pointer truncate text-right font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          data-testid={link.testId}
          onClick={link.onClick}
          type="button"
        >
          {value}
        </button>
      )}
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
  onCountChange,
  onChanged,
}: {
  item: WorkItemViewModel;
  spaceId?: string;
  organizationId?: string;
  lookup: ReturnType<typeof useSpaceMembers>;
  canComment: boolean;
  t: ReturnType<typeof useTranslations<"taskDetail">>;
  tApiError: ReturnType<typeof useTranslations>;
  onCountChange?: (count: number) => void;
  onChanged?: () => void;
}) {
  const locale = useLocale();
  const requestKey = getWorkItemSubresourceRequestKey({
    item,
    organizationId,
    spaceId,
  });
  const latestRequestKeyRef = useRef(requestKey);
  const requestSeqRef = useRef(0);
  latestRequestKeyRef.current = requestKey;
  const [commentsState, setCommentsState] = useState(() => ({
    comments: [] as Comment[],
    error: null as string | null,
    loading: false,
    requestKey,
  }));
  const [draft, setDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const currentCommentsState =
    commentsState.requestKey === requestKey
      ? commentsState
      : {
          comments: [] as Comment[],
          error: null,
          loading: Boolean(spaceId),
          requestKey,
        };
  const comments = currentCommentsState.comments;
  const loading = currentCommentsState.loading;
  const error = currentCommentsState.error;

  const fetchComments = useCallback(async (options?: RefreshModeOptions) => {
    const refreshMode = resolveRefreshMode(options, "initial");
    const nextRequestKey = requestKey;
    requestSeqRef.current += 1;
    const requestSeq = requestSeqRef.current;

    if (!spaceId) {
      setCommentsState({
        comments: [],
        error: null,
        loading: false,
        requestKey: nextRequestKey,
      });
      return;
    }

    setCommentsState((current) => {
      const sameRequestKey = current.requestKey === nextRequestKey;

      return {
        comments: sameRequestKey ? current.comments : [],
        error: shouldSurfaceRefreshError(refreshMode) ? null : current.error,
        loading: shouldShowBlockingRefreshState(refreshMode),
        requestKey: nextRequestKey,
      };
    });

    const isLatestRequest = () =>
      requestSeqRef.current === requestSeq &&
      latestRequestKeyRef.current === nextRequestKey;

    try {
      const result = await listComments({
        organizationId,
        spaceId,
        targetId: item.id,
        targetType: "WORK_ITEM",
      });
      if (!isLatestRequest()) return;
      setCommentsState({
        comments: result.items,
        error: null,
        loading: false,
        requestKey: nextRequestKey,
      });
      onCountChange?.(result.total);
    } catch (err) {
      if (!isLatestRequest()) return;
      const key = getApiErrorMessageKey(err);
      if (shouldSurfaceRefreshError(refreshMode)) {
        setCommentsState({
          comments: [],
          error: tApiError(key),
          loading: false,
          requestKey: nextRequestKey,
        });
      }
    } finally {
      if (isLatestRequest()) {
        setCommentsState((current) =>
          current.requestKey === nextRequestKey
            ? { ...current, loading: false }
            : current,
        );
      }
    }
  }, [item.id, onCountChange, organizationId, requestKey, spaceId, tApiError]);

  useEffect(() => {
    void fetchComments({ mode: "initial" });
  }, [fetchComments]);

  useRealtimeInvalidation(WORK_ITEM_COMMENTS_REALTIME_KEYS, (context) => {
    if (
      realtimeContextIncludesTarget(context, {
        id: item.id,
        type: "WORK_ITEM",
      })
    ) {
      void fetchComments({ mode: "realtime" });
    }
  });

  useEffect(() => {
    setDraft("");
    setSubmitError(null);
    setSubmitting(false);
  }, [requestKey]);

  const handleSubmit = async () => {
    const body = draft.trim();
    if (!body || !spaceId || !canComment) return;
    const submitRequestKey = requestKey;
    const targetId = item.id;

    setSubmitting(true);
    setSubmitError(null);

    try {
      const created = await createComment({
        body,
        organizationId,
        spaceId,
        targetId,
        targetType: "WORK_ITEM",
      });
      if (latestRequestKeyRef.current !== submitRequestKey) return;
      setCommentsState((current) =>
        current.requestKey === submitRequestKey
          ? { ...current, comments: [...current.comments, created] }
          : current,
      );
      setDraft("");
      onChanged?.();
    } catch (err) {
      if (latestRequestKeyRef.current !== submitRequestKey) return;
      const key = getApiErrorMessageKey(err);
      setSubmitError(tApiError(key));
    } finally {
      if (latestRequestKeyRef.current === submitRequestKey) {
        setSubmitting(false);
      }
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
                        {formatDateTime(comment.createdAt, locale)}
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
  onCountChange,
  onTimelineRefresh,
}: {
  item: WorkItemViewModel;
  spaceId?: string;
  organizationId?: string;
  lookup: ReturnType<typeof useSpaceMembers>;
  canUploadAttachment: boolean;
  t: ReturnType<typeof useTranslations<"taskDetail">>;
  tApiError: ReturnType<typeof useTranslations>;
  onCountChange?: (count: number) => void;
  onTimelineRefresh?: () => void;
}) {
  const locale = useLocale();
  const requestKey = getWorkItemSubresourceRequestKey({
    item,
    organizationId,
    spaceId,
  });
  const latestRequestKeyRef = useRef(requestKey);
  const requestSeqRef = useRef(0);
  latestRequestKeyRef.current = requestKey;
  const [attachmentsState, setAttachmentsState] = useState(() => ({
    attachments: [] as Attachment[],
    error: null as string | null,
    loading: false,
    requestKey,
  }));
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [attachmentActionError, setAttachmentActionError] = useState<
    string | null
  >(null);
  const [uploading, setUploading] = useState(false);
  const [dragDepth, setDragDepth] = useState(0);
  const [openingAttachmentId, setOpeningAttachmentId] = useState<string | null>(
    null,
  );
  const uploadingRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const dropZoneRef = useRef<HTMLDivElement | null>(null);

  const currentAttachmentsState =
    attachmentsState.requestKey === requestKey
      ? attachmentsState
      : {
          attachments: [] as Attachment[],
          error: null,
          loading: Boolean(spaceId),
          requestKey,
        };
  const attachments = currentAttachmentsState.attachments;
  const loading = currentAttachmentsState.loading;
  const error = currentAttachmentsState.error;

  const fetchAttachments = useCallback(async (options?: RefreshModeOptions) => {
    const refreshMode = resolveRefreshMode(options, "initial");
    const nextRequestKey = requestKey;
    requestSeqRef.current += 1;
    const requestSeq = requestSeqRef.current;

    if (!spaceId) {
      setAttachmentsState({
        attachments: [],
        error: null,
        loading: false,
        requestKey: nextRequestKey,
      });
      return;
    }

    setAttachmentsState((current) => {
      const sameRequestKey = current.requestKey === nextRequestKey;

      return {
        attachments: sameRequestKey ? current.attachments : [],
        error: shouldSurfaceRefreshError(refreshMode) ? null : current.error,
        loading: shouldShowBlockingRefreshState(refreshMode),
        requestKey: nextRequestKey,
      };
    });

    const isLatestRequest = () =>
      requestSeqRef.current === requestSeq &&
      latestRequestKeyRef.current === nextRequestKey;

    try {
      const result = await listAttachments({
        organizationId,
        spaceId,
        targetId: item.id,
        targetType: "WORK_ITEM",
      });
      if (!isLatestRequest()) return;
      setAttachmentsState({
        attachments: result.items,
        error: null,
        loading: false,
        requestKey: nextRequestKey,
      });
      onCountChange?.(result.total);
    } catch (err) {
      if (!isLatestRequest()) return;
      const key = getApiErrorMessageKey(err);
      if (shouldSurfaceRefreshError(refreshMode)) {
        setAttachmentsState({
          attachments: [],
          error: tApiError(key),
          loading: false,
          requestKey: nextRequestKey,
        });
      }
    } finally {
      if (isLatestRequest()) {
        setAttachmentsState((current) =>
          current.requestKey === nextRequestKey
            ? { ...current, loading: false }
            : current,
        );
      }
    }
  }, [item.id, onCountChange, organizationId, requestKey, spaceId, tApiError]);

  useEffect(() => {
    void fetchAttachments({ mode: "initial" });
  }, [fetchAttachments]);

  useRealtimeInvalidation(WORK_ITEM_ATTACHMENTS_REALTIME_KEYS, (context) => {
    if (
      realtimeContextIncludesTarget(context, {
        id: item.id,
        type: "WORK_ITEM",
      })
    ) {
      void fetchAttachments({ mode: "realtime" });
    }
  });

  useEffect(() => {
    setUploadError(null);
    setAttachmentActionError(null);
    setUploading(false);
    uploadingRef.current = false;
    setDragDepth(0);
    setOpeningAttachmentId(null);
  }, [requestKey]);

  useEffect(() => {
    if (canUploadAttachment && spaceId) {
      dropZoneRef.current?.focus({ preventScroll: true });
    }
  }, [canUploadAttachment, requestKey, spaceId]);

  const uploadFiles = useCallback(
    async (files: File[]) => {
      if (
        files.length === 0 ||
        !canUploadAttachment ||
        !spaceId ||
        uploadingRef.current
      ) {
        return;
      }
      const uploadRequestKey = requestKey;
      let nextAttachmentCount = attachments.length;
      let uploadedAny = false;
      let latestError: string | null = null;

      setUploadError(null);
      setAttachmentActionError(null);
      uploadingRef.current = true;
      setUploading(true);
      try {
        for (const file of files) {
          try {
            await uploadAttachment({
              existingAttachmentCount: nextAttachmentCount,
              file,
              targetId: item.id,
              targetType: "WORK_ITEM",
            });
            if (latestRequestKeyRef.current !== uploadRequestKey) {
              return;
            }
            nextAttachmentCount += 1;
            uploadedAny = true;
          } catch (err) {
            if (latestRequestKeyRef.current !== uploadRequestKey) {
              return;
            }
            if (err instanceof AttachmentUploadError) {
              latestError = tApiError(
                `forms.attachments.uploadErrors.${err.code}`,
              );
              if (err.code === "ATTACHMENT_LIMIT_EXCEEDED") {
                break;
              }
            } else {
              latestError = tApiError(getApiErrorMessageKey(err));
            }
          }
        }

        if (uploadedAny) {
          await fetchAttachments();
        }
        if (latestRequestKeyRef.current === uploadRequestKey && uploadedAny) {
          onTimelineRefresh?.();
        }
        if (latestRequestKeyRef.current === uploadRequestKey && latestError) {
          setUploadError(latestError);
        }
      } finally {
        if (latestRequestKeyRef.current === uploadRequestKey) {
          uploadingRef.current = false;
          setUploading(false);
        }
      }
    },
    [
      attachments.length,
      canUploadAttachment,
      fetchAttachments,
      item.id,
      onTimelineRefresh,
      requestKey,
      spaceId,
      tApiError,
    ],
  );

  const handleFileChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const files = getTransferFiles(event.target.files);
      event.target.value = "";
      void uploadFiles(files);
    },
    [uploadFiles],
  );

  const handlePaste = useCallback(
    (event: React.ClipboardEvent<HTMLDivElement>) => {
      const files = getTransferFiles(event.clipboardData?.files);

      if (
        files.length === 0 ||
        !canUploadAttachment ||
        !spaceId ||
        uploading ||
        uploadingRef.current
      ) {
        return;
      }

      event.preventDefault();
      void uploadFiles(files);
    },
    [canUploadAttachment, spaceId, uploadFiles, uploading],
  );

  const handleDragEnter = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      if (!hasTransferFiles(event.dataTransfer)) {
        return;
      }
      if (
        !canUploadAttachment ||
        !spaceId ||
        uploading ||
        uploadingRef.current
      ) {
        return;
      }

      event.preventDefault();
      setDragDepth((depth) => depth + 1);
    },
    [canUploadAttachment, spaceId, uploading],
  );

  const handleDragOver = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      if (!hasTransferFiles(event.dataTransfer)) {
        return;
      }
      if (
        !canUploadAttachment ||
        !spaceId ||
        uploading ||
        uploadingRef.current
      ) {
        return;
      }

      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
    },
    [canUploadAttachment, spaceId, uploading],
  );

  const handleDragLeave = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      if (!hasTransferFiles(event.dataTransfer)) {
        return;
      }
      if (
        !canUploadAttachment ||
        !spaceId ||
        uploading ||
        uploadingRef.current
      ) {
        return;
      }

      event.preventDefault();
      setDragDepth((depth) => Math.max(0, depth - 1));
    },
    [canUploadAttachment, spaceId, uploading],
  );

  const handleDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      if (!hasTransferFiles(event.dataTransfer)) {
        return;
      }
      if (
        !canUploadAttachment ||
        !spaceId ||
        uploading ||
        uploadingRef.current
      ) {
        return;
      }

      event.preventDefault();
      const files = getTransferFiles(event.dataTransfer.files);
      setDragDepth(0);
      void uploadFiles(files);
    },
    [canUploadAttachment, spaceId, uploadFiles, uploading],
  );

  const handleAttachmentAction = useCallback(
    async (attachment: Attachment, action: "download" | "preview") => {
      if (!spaceId) {
        return;
      }

      const actionRequestKey = requestKey;
      const actionId = `${action}:${attachment.id}`;
      setAttachmentActionError(null);
      setOpeningAttachmentId(actionId);

      try {
        const result = await getAttachmentDownloadUrl({
          attachmentId: attachment.id,
          organizationId,
          spaceId,
        });

        if (latestRequestKeyRef.current !== actionRequestKey) {
          return;
        }

        if (action === "preview") {
          window.open(result.downloadUrl, "_blank", "noopener,noreferrer");
        } else {
          triggerAttachmentDownload(result.downloadUrl, attachment.fileName);
        }
      } catch (err) {
        if (latestRequestKeyRef.current !== actionRequestKey) {
          return;
        }
        const key = getApiErrorMessageKey(err);
        setAttachmentActionError(tApiError(key));
      } finally {
        if (latestRequestKeyRef.current === actionRequestKey) {
          setOpeningAttachmentId(null);
        }
      }
    },
    [organizationId, requestKey, spaceId, tApiError],
  );

  const dropActive = dragDepth > 0 && canUploadAttachment && Boolean(spaceId);

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
              multiple
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
              title={t("attachments.uploadHint")}
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
      <div
        ref={dropZoneRef}
        aria-label={
          canUploadAttachment ? t("attachments.dropZoneLabel") : undefined
        }
        className={cn(
          "relative flex-1 overflow-y-auto outline-none transition-colors",
          canUploadAttachment &&
            spaceId &&
            "focus-visible:ring-2 focus-visible:ring-primary/40",
          dropActive && "bg-primary/5 ring-1 ring-inset ring-primary/40",
        )}
        data-testid="task-attachments-drop-zone"
        tabIndex={canUploadAttachment && spaceId ? 0 : undefined}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        onPaste={handlePaste}
      >
        {dropActive ? (
          <div className="pointer-events-none absolute inset-2 z-10 flex items-center justify-center rounded-md border border-dashed border-primary/60 bg-background/85 text-xs font-medium text-primary shadow-sm">
            {t("attachments.dropActive")}
          </div>
        ) : null}
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
                        {formatDateTime(attachment.createdAt, locale)}
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

function getTransferFiles(fileList: FileList | null | undefined): File[] {
  return Array.from(fileList ?? []);
}

function hasTransferFiles(
  dataTransfer: DataTransfer | null | undefined,
): boolean {
  if (!dataTransfer) {
    return false;
  }

  return (
    Array.from(dataTransfer.types ?? []).includes("Files") ||
    dataTransfer.files.length > 0
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
  refreshVersion,
}: {
  item: WorkItemViewModel;
  spaceId?: string;
  organizationId?: string;
  t: ReturnType<typeof useTranslations<"taskDetail">>;
  tApiError: ReturnType<typeof useTranslations>;
  refreshVersion: number;
}) {
  const locale = useLocale();
  const tTimelineEvent = useTranslations("common.timeline.event");
  const requestKey = getWorkItemSubresourceRequestKey({
    item,
    organizationId,
    spaceId,
  });
  const latestRequestKeyRef = useRef(requestKey);
  const requestSeqRef = useRef(0);
  latestRequestKeyRef.current = requestKey;
  const [timelineState, setTimelineState] = useState(() => ({
    error: null as string | null,
    events: [] as TimelineEvent[],
    loading: false,
    requestKey,
  }));

  const currentTimelineState =
    timelineState.requestKey === requestKey
      ? timelineState
      : {
          error: null,
          events: [] as TimelineEvent[],
          loading: Boolean(spaceId),
          requestKey,
        };
  const events = currentTimelineState.events;
  const loading = currentTimelineState.loading;
  const error = currentTimelineState.error;

  const fetchEvents = useCallback(async (options?: RefreshModeOptions) => {
    const refreshMode = resolveRefreshMode(options, "initial");
    const nextRequestKey = requestKey;
    requestSeqRef.current += 1;
    const requestSeq = requestSeqRef.current;

    if (!spaceId) {
      setTimelineState({
        error: null,
        events: [],
        loading: false,
        requestKey: nextRequestKey,
      });
      return;
    }

    setTimelineState((current) => {
      const sameRequestKey = current.requestKey === nextRequestKey;

      return {
        error: shouldSurfaceRefreshError(refreshMode) ? null : current.error,
        events: sameRequestKey ? current.events : [],
        loading: shouldShowBlockingRefreshState(refreshMode),
        requestKey: nextRequestKey,
      };
    });

    const isLatestRequest = () =>
      requestSeqRef.current === requestSeq &&
      latestRequestKeyRef.current === nextRequestKey;

    try {
      const result = await listTimeline({
        organizationId,
        spaceId,
        targetId: item.id,
        targetType: "WORK_ITEM",
      });
      if (!isLatestRequest()) return;
      setTimelineState({
        error: null,
        events: result.items,
        loading: false,
        requestKey: nextRequestKey,
      });
    } catch (err) {
      if (!isLatestRequest()) return;
      const key = getApiErrorMessageKey(err);
      if (shouldSurfaceRefreshError(refreshMode)) {
        setTimelineState({
          error: tApiError(key),
          events: [],
          loading: false,
          requestKey: nextRequestKey,
        });
      }
    } finally {
      if (isLatestRequest()) {
        setTimelineState((current) =>
          current.requestKey === nextRequestKey
            ? { ...current, loading: false }
            : current,
        );
      }
    }
  }, [item.id, organizationId, requestKey, spaceId, tApiError]);

  useEffect(() => {
    void fetchEvents({ mode: refreshVersion > 0 ? "realtime" : "initial" });
  }, [fetchEvents, refreshVersion]);

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
      {events.map((event) => (
        <TimelineEventItem
          key={event.id}
          event={event}
          locale={locale}
          testId="task-timeline-item"
          translateEventType={tTimelineEvent}
        />
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------

function FieldRow({
  contentClassName,
  icon: Icon,
  label,
  rootClassName,
  value,
}: {
  contentClassName?: string;
  icon: typeof User2;
  label: string;
  rootClassName?: string;
  value: React.ReactNode;
}) {
  return (
    <div className={cn("flex min-w-0 items-start gap-2", rootClassName)}>
      <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <span className="shrink-0 text-[11px] uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <div
        className={cn(
          "ml-auto min-w-0 font-medium text-foreground",
          contentClassName,
        )}
      >
        {value}
      </div>
    </div>
  );
}

export type { Props as TaskDetailSheetProps };
