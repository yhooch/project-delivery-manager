"use client";

import type {
  ActionFormFieldSummary,
  Attachment,
  BugView,
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
import { getBug } from "../../lib/bug-service";
import { createComment, listComments } from "../../lib/comment-service";
import { listIntakeItems } from "../../lib/intake-service";
import { listRequirements } from "../../lib/requirement-service";
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
} from "../../lib/v2/lookups";
import {
  filterTraceOptionsByVersion,
  isTraceOptionCompatibleWithVersion,
} from "../../lib/versioned-trace-linking";
import { toUpdateTaskRequest } from "../../lib/work-item-forms";
import { getWorkItem, updateWorkItem } from "../../lib/work-item-service";

import { useSession } from "../providers/session-provider";
import { IntakeDetailSheet } from "../intake/intake-detail-sheet";
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

const TASK_PRIORITIES: Priority[] = ["LOW", "MEDIUM", "HIGH", "URGENT"];

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
        open={open}
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
  spaceId?: string;
  organizationId?: string;
  currentUserId?: string;
  t: ReturnType<typeof useTranslations<"taskDetail">>;
  tApiError: ReturnType<typeof useTranslations>;
  onChanged?: () => void;
};

function TaskDetailSheetBody({
  item,
  open,
  spaceId,
  organizationId,
  currentUserId: _currentUserId,
  t,
  tApiError,
  onChanged,
}: BodyProps) {
  const locale = useLocale();
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
    ? (getVersion(detail.versionId)?.name ??
      missingLookupLabel(detail.versionId))
    : item.versionName;
  const dueDate = detail?.dueDate
    ? formatDateTime(detail.dueDate, "default")
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
            },
            statusLabel: (category) =>
              tApiError(`workItems.statusCategory.${category}`),
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
          },
          statusLabel: (category) =>
            tApiError(`workItems.statusCategory.${category}`),
        }),
      );
      setNestedTaskOpen(true);
    },
    [getVersion, locale, lookup.getMember, tApiError],
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
  const fetchSubresourceCounts = useCallback(async () => {
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

    setCountState({
      attachments: null,
      comments: null,
      requestKey: nextRequestKey,
    });

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
    void fetchSubresourceCounts();
  }, [fetchSubresourceCounts]);

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
            <span>{isBug ? "BUG" : "TASK"}</span>
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
                <span className="ml-2 text-foreground/80">{blockedReason}</span>
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
              canEdit={!isBug && permissionState.permissions?.canEdit === true}
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
  onTimelineRefresh,
}: {
  item: WorkItemViewModel;
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

  const resetActionForm = useCallback(() => {
    setSelectedAction(null);
    setCommentDraft("");
    setFormDraft({});
    setFormErrors(createEmptyActionFormErrors());
  }, []);

  const beginAction = (action: WorkflowActionSummary) => {
    setExecuteError(null);
    setFormErrors(createEmptyActionFormErrors());

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
            action.name
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
  const label = field.required ? `${field.label} *` : field.label;
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
        <select
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
              {option}
            </option>
          ))}
        </select>
        {error}
      </div>
    );
  }

  if (field.fieldType === "USER") {
    const hasMembers = lookup.members.length > 0;

    return (
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={id}>{label}</Label>
        <select
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
        </select>
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
  const assigneeId = detail?.assigneeId || undefined;
  const assignee = displayUser(assigneeId, lookup.getMember);
  const reporter = displayUser(detail?.reporterId, lookup.getMember);
  const updatedAt = detail?.lastActionAt ?? detail?.lastStatusChangedAt;
  const bugDetail = isBugSheetDetail(detail) ? detail.bugDetail : null;
  const { versions } = useVersions(spaceId, organizationId);
  const [editing, setEditing] = useState(false);
  const [requirements, setRequirements] = useState<Requirement[]>([]);
  const [intakeItems, setIntakeItems] = useState<IntakeItem[]>([]);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<Priority>("MEDIUM");
  const [editAssigneeId, setEditAssigneeId] = useState("");
  const [editVersionId, setEditVersionId] = useState("");
  const [editRequirementId, setEditRequirementId] = useState("");
  const [editIntakeItemId, setEditIntakeItemId] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [titleError, setTitleError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const resetEditDraft = useCallback(() => {
    setTitle(detail?.title ?? item.title);
    setDescription(detail?.description ?? "");
    setPriority(detail?.priority ?? item.priority);
    setEditAssigneeId(detail?.assigneeId ?? "");
    setEditVersionId(detail?.versionId ?? "");
    setEditRequirementId(detail?.requirementId ?? "");
    setEditIntakeItemId(detail?.intakeItemId ?? "");
    setDueDate(toDateInputValue(detail?.dueDate));
    setTitleError(false);
    setSaveError(null);
  }, [
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
    resetEditDraft();
  }, [resetEditDraft]);

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
    ])
      .then(([requirementResult, intakeResult]) => {
        if (!cancelled) {
          setRequirements(requirementResult.items);
          setIntakeItems(intakeResult.items);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setRequirements([]);
          setIntakeItems([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [editing, organizationId, spaceId]);

  const selectedRequirement = useMemo(
    () =>
      requirements.find((requirement) => requirement.id === editRequirementId),
    [editRequirementId, requirements],
  );
  const selectedIntakeItem = useMemo(
    () => intakeItems.find((intakeItem) => intakeItem.id === editIntakeItemId),
    [editIntakeItemId, intakeItems],
  );
  const filteredRequirements = useMemo(
    () => filterTraceOptionsByVersion(requirements, editVersionId),
    [editVersionId, requirements],
  );
  const filteredIntakeItems = useMemo(
    () => filterTraceOptionsByVersion(intakeItems, editVersionId),
    [editVersionId, intakeItems],
  );

  function handleEditVersionChange(nextVersionId: string) {
    setEditVersionId(nextVersionId);

    if (
      !isTraceOptionCompatibleWithVersion(selectedRequirement, nextVersionId)
    ) {
      setEditRequirementId("");
    }
    if (
      !isTraceOptionCompatibleWithVersion(selectedIntakeItem, nextVersionId)
    ) {
      setEditIntakeItemId("");
    }
  }

  function handleEditRequirementChange(nextRequirementId: string) {
    setEditRequirementId(nextRequirementId);

    const nextRequirement = requirements.find(
      (requirement) => requirement.id === nextRequirementId,
    );
    const nextVersionId = nextRequirement?.versionId;

    if (nextVersionId) {
      setEditVersionId(nextVersionId);
      if (
        !isTraceOptionCompatibleWithVersion(selectedIntakeItem, nextVersionId)
      ) {
        setEditIntakeItemId("");
      }
    }
  }

  function handleEditIntakeItemChange(nextIntakeItemId: string) {
    setEditIntakeItemId(nextIntakeItemId);

    const nextIntakeItem = intakeItems.find(
      (intakeItem) => intakeItem.id === nextIntakeItemId,
    );
    const nextVersionId = nextIntakeItem?.versionId;

    if (nextVersionId) {
      setEditVersionId(nextVersionId);
      if (
        !isTraceOptionCompatibleWithVersion(selectedRequirement, nextVersionId)
      ) {
        setEditRequirementId("");
      }
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

    try {
      await updateWorkItem(
        {
          organizationId,
          spaceId,
          workItemId: detail.id,
        },
        toUpdateTaskRequest({
          assigneeId: editAssigneeId,
          description,
          dueDate: dueDate ? new Date(`${dueDate}T00:00:00`).toISOString() : "",
          priority,
          intakeItemId: editIntakeItemId,
          requirementId: editRequirementId,
          title: trimmedTitle,
          versionId: editVersionId,
        }),
      );
      await onSaved();
      setEditing(false);
    } catch (err) {
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
              <select
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
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="task-edit-assignee">{t("fields.assignee")}</Label>
              <select
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
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="task-edit-version">{t("fields.version")}</Label>
              <select
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
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="task-edit-requirement">
                {t("fields.requirement")}
              </Label>
              <select
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
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="task-edit-intake">{t("fields.intake")}</Label>
              <select
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
              </select>
            </div>
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
        <a
          className="ml-auto cursor-pointer truncate font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          data-testid="task-requirement-link"
          href={link.href}
          rel="noopener noreferrer"
          target="_blank"
        >
          {value}
        </a>
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

  const fetchComments = useCallback(async () => {
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

    setCommentsState({
      comments: [],
      error: null,
      loading: true,
      requestKey: nextRequestKey,
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
      setCommentsState({
        comments: [],
        error: tApiError(key),
        loading: false,
        requestKey: nextRequestKey,
      });
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
    void fetchComments();
  }, [fetchComments]);

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
  const [openingAttachmentId, setOpeningAttachmentId] = useState<string | null>(
    null,
  );
  const fileInputRef = useRef<HTMLInputElement | null>(null);

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

  const fetchAttachments = useCallback(async () => {
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

    setAttachmentsState({
      attachments: [],
      error: null,
      loading: true,
      requestKey: nextRequestKey,
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
      setAttachmentsState({
        attachments: [],
        error: tApiError(key),
        loading: false,
        requestKey: nextRequestKey,
      });
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
    void fetchAttachments();
  }, [fetchAttachments]);

  useEffect(() => {
    setUploadError(null);
    setAttachmentActionError(null);
    setUploading(false);
    setOpeningAttachmentId(null);
  }, [requestKey]);

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
      const uploadRequestKey = requestKey;
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
        if (latestRequestKeyRef.current !== uploadRequestKey) {
          return;
        }
        await fetchAttachments();
        if (latestRequestKeyRef.current === uploadRequestKey) {
          onTimelineRefresh?.();
        }
      } catch (err) {
        if (latestRequestKeyRef.current !== uploadRequestKey) {
          return;
        }
        if (err instanceof AttachmentUploadError) {
          setUploadError(
            tApiError(`forms.attachments.uploadErrors.${err.code}`),
          );
        } else {
          setUploadError(tApiError(getApiErrorMessageKey(err)));
        }
      } finally {
        if (latestRequestKeyRef.current === uploadRequestKey) {
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
      tApiError,
    ],
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
  refreshVersion,
}: {
  item: WorkItemViewModel;
  spaceId?: string;
  organizationId?: string;
  t: ReturnType<typeof useTranslations<"taskDetail">>;
  tApiError: ReturnType<typeof useTranslations>;
  refreshVersion: number;
}) {
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

  const fetchEvents = useCallback(async () => {
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

    setTimelineState({
      error: null,
      events: [],
      loading: true,
      requestKey: nextRequestKey,
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
      setTimelineState({
        error: tApiError(key),
        events: [],
        loading: false,
        requestKey: nextRequestKey,
      });
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
    void fetchEvents();
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
